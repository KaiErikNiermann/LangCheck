//! Resolving the config's references against the world outside the file.
//!
//! A config key is one of two kinds. `dialect: "American"` is settled by
//! reading it -- the value is in a fixed set, and the file alone says whether
//! it is right. `url: "http://localhost:8010"` is not: the text can be
//! perfectly well-formed and still name a server that is not running, and no
//! amount of staring at the file will say which. Only the second kind is
//! probed here, and only the second kind earns a mark in the editor's gutter.
//!
//! That split is the whole design. A mark means a probe ran and produced an
//! outcome; anything decidable from the text is a diagnostic with no mark.
//! Marking the first kind too would put a green tick next to an enum check,
//! and once a few of those are on screen the column stops carrying
//! information.
//!
//! Every probe is reported against the dotted path of the key it is about, so
//! the editor can put the squiggle under the value that failed rather than
//! over the block that contains it.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::checker;
use crate::config::Config;

/// How long any one probe may take before it is called down.
///
/// Short on purpose: this runs while someone is typing, and an answer that
/// arrives after they have moved on is worse than no answer. The engines
/// themselves are given much longer, because there the user is waiting for a
/// result they asked for.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// What a probe found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeStatus {
    /// Resolved: the server answered, the file was read, the name is real.
    Ok,
    /// Reached, but not entirely as configured.
    Degraded,
    /// Did not resolve.
    Down,
    /// Not probed, because the engine is switched off.
    Skipped,
}

impl ProbeStatus {
    /// Which of two outcomes an engine's line should show when it has both.
    ///
    /// Ordered by how much it should worry the reader, so a block with one
    /// broken reference reads as broken however many of its other keys
    /// resolved.
    #[must_use]
    const fn severity(self) -> u8 {
        match self {
            Self::Skipped => 0,
            Self::Ok => 1,
            Self::Degraded => 2,
            Self::Down => 3,
        }
    }

    #[must_use]
    pub const fn worst(self, other: Self) -> Self {
        if other.severity() > self.severity() { other } else { self }
    }

    #[must_use]
    const fn wire(self) -> checker::ProbeStatus {
        match self {
            Self::Ok => checker::ProbeStatus::Ok,
            Self::Degraded => checker::ProbeStatus::Degraded,
            Self::Down => checker::ProbeStatus::Down,
            Self::Skipped => checker::ProbeStatus::Skipped,
        }
    }
}

/// One key's outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    /// Dotted path to the key, e.g. `engines.languagetool.url`.
    pub key: String,
    pub status: ProbeStatus,
    /// One line naming what was reached and what it answered.
    pub detail: String,
    /// The owning engine, empty for a top-level key.
    pub engine: String,
    /// Whether the key is at fault rather than its value.
    pub blames_key: bool,
}

impl Probe {
    fn new(
        key: impl Into<String>,
        engine: &str,
        status: ProbeStatus,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            key: key.into(),
            status,
            detail: detail.into(),
            engine: engine.to_string(),
            blames_key: false,
        }
    }

    /// Mark this as a finding about the key itself.
    ///
    /// A rule name the engine does not have is a bad key; underlining the
    /// `false` beside it would point at the wrong token.
    #[must_use]
    const fn blaming_key(mut self) -> Self {
        self.blames_key = true;
        self
    }

    #[must_use]
    pub fn into_wire(self) -> checker::ConfigProbe {
        checker::ConfigProbe {
            key: self.key,
            status: self.status.wire() as i32,
            detail: self.detail,
            engine: self.engine,
            blames_key: self.blames_key,
        }
    }
}

/// Probe every external reference in `config`, concurrently.
///
/// The engines do not depend on each other, and the slowest of them is a
/// network round trip, so running them in sequence would add their latencies
/// for no reason.
pub async fn probe_config(config: &Config, workspace_root: &Path) -> Vec<Probe> {
    let (harper, languagetool, vale, proselint, spell) = tokio::join!(
        probe_harper(config),
        probe_languagetool(config),
        probe_vale(config),
        probe_proselint(config),
        probe_spell_language(config, workspace_root),
    );

    let mut out = Vec::new();
    out.extend(harper);
    out.extend(languagetool);
    out.extend(vale);
    out.extend(proselint);
    out.extend(spell);
    out
}

/// Harper runs in this process, so the engine itself cannot be unreachable.
///
/// Its rule names can still be wrong, and that is the failure worth catching:
/// a misspelled linter key is accepted in silence today and simply does not
/// apply, so the rule the user switched off stays on with nothing to say so.
async fn probe_harper(config: &Config) -> Vec<Probe> {
    const ENGINE: &str = "harper";
    if !config.engines.harper.enabled {
        return vec![Probe::new(
            "engines.harper",
            ENGINE,
            ProbeStatus::Skipped,
            "Harper is switched off.",
        )];
    }

    let linters = config.engines.harper.linters.clone();
    // Building the curated lint group loads the bundled FST dictionary, which
    // is worth keeping off the thread the editor is talking to.
    let unknown: Vec<String> = tokio::task::spawn_blocking(move || {
        if linters.is_empty() {
            return Vec::new();
        }
        let dict = harper_core::spell::FstDictionary::curated();
        let group = harper_core::linting::LintGroup::new_curated(
            dict,
            harper_core::Dialect::American,
        );
        let mut unknown: Vec<String> = linters
            .keys()
            .filter(|name| !group.contains_key(name))
            .cloned()
            .collect();
        unknown.sort();
        unknown
    })
    .await
    .unwrap_or_default();

    let mut probes = vec![Probe::new(
        "engines.harper",
        ENGINE,
        ProbeStatus::Ok,
        "Harper is built in and always available.",
    )];
    for name in unknown {
        probes.push(
            Probe::new(
                format!("engines.harper.linters.{name}"),
                ENGINE,
                ProbeStatus::Down,
                format!(
                    "Harper has no linter called \"{name}\", so this setting does nothing. \
                     Rule names are case-sensitive and spelled like LongSentences."
                ),
            )
            .blaming_key(),
        );
    }
    probes
}

/// Whether the configured `LanguageTool` server is up, and whether it serves
/// the language it is being asked for.
///
/// `GET /v2/languages` rather than a `/v2/check` with sample text: it is the
/// cheapest endpoint that proves the server is a `LanguageTool` and not
/// merely something listening on that port, and its answer is exactly the
/// list needed to tell whether `spell_language` is servable.
async fn probe_languagetool(config: &Config) -> Vec<Probe> {
    const ENGINE: &str = "languagetool";
    let lt = &config.engines.languagetool;
    if !lt.enabled {
        return vec![Probe::new(
            "engines.languagetool",
            ENGINE,
            ProbeStatus::Skipped,
            "LanguageTool is switched off.",
        )];
    }

    // Reported against the block and against the URL both: the block is what
    // carries the gutter mark, and the URL is what the squiggle goes under.
    let blame_url = |why: String| {
        vec![
            Probe::new("engines.languagetool", ENGINE, ProbeStatus::Down, why.clone()),
            Probe::new("engines.languagetool.url", ENGINE, ProbeStatus::Down, why),
        ]
    };

    if let Err(why) = crate::engines::usable_languagetool_url(&lt.url) {
        return blame_url(why);
    }

    let endpoint = format!("{}/v2/languages", lt.url.trim_end_matches('/'));
    let entries = match languagetool_languages(&endpoint).await {
        Ok(entries) => entries,
        Err(why) => return blame_url(why),
    };

    let served: BTreeSet<String> = entries
        .iter()
        .flat_map(|entry| [entry.code.to_lowercase(), entry.long_code.to_lowercase()])
        .collect();

    let reached = format!(
        "LanguageTool answered at {}, serving {} languages.",
        lt.url,
        entries.len()
    );
    let mut probes = vec![
        Probe::new("engines.languagetool", ENGINE, ProbeStatus::Ok, reached.clone()),
        Probe::new("engines.languagetool.url", ENGINE, ProbeStatus::Ok, reached),
    ];

    // A server that is up but does not serve the language being checked is
    // the case a bare reachability probe calls healthy and the user
    // experiences as LanguageTool silently doing nothing.
    if !serves(&served, &config.engines.spell_language) {
        probes.push(Probe::new(
            "engines.languagetool",
            ENGINE,
            ProbeStatus::Degraded,
            format!(
                "LanguageTool is up at {} but does not serve \"{}\", so it will not report \
                 anything for this workspace.",
                lt.url, config.engines.spell_language
            ),
        ));
    }

    if let Some(mother) = &lt.mother_tongue
        && !serves(&served, mother)
    {
        probes.push(Probe::new(
            "engines.languagetool.mother_tongue",
            ENGINE,
            ProbeStatus::Degraded,
            format!(
                "This server does not serve \"{mother}\", so false-friend detection will \
                 not run."
            ),
        ));
    }

    probes
}

/// Whether a served-language set covers a BCP-47 tag.
///
/// `en-US` is covered by a server offering plain `en`, because that is what
/// `LanguageTool` does with the tag when it receives it. An empty tag is
/// nothing to complain about and counts as covered.
fn serves(served: &BTreeSet<String>, tag: &str) -> bool {
    if tag.is_empty() {
        return true;
    }
    let tag = tag.to_lowercase();
    if served.contains(&tag) {
        return true;
    }
    let base = tag.split('-').next().unwrap_or(&tag);
    served.contains(base)
}

/// `GET /v2/languages`, with the failure phrased as advice.
async fn languagetool_languages(endpoint: &str) -> Result<Vec<LanguageEntry>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(PROBE_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|e| format!("Could not build an HTTP client to reach LanguageTool: {e}"))?;

    let response = client.get(endpoint).send().await.map_err(|e| {
        format!(
            "Could not reach {endpoint}: {}. Start the server, or set \
             engines.languagetool.enabled to false.",
            terse_reqwest_error(&e)
        )
    })?;

    if !response.status().is_success() {
        return Err(format!(
            "{endpoint} answered {}. Check that engines.languagetool.url points at a \
             LanguageTool server.",
            response.status()
        ));
    }

    response.json::<Vec<LanguageEntry>>().await.map_err(|e| {
        format!(
            "{endpoint} answered, but not with a LanguageTool language list ({e}). Check \
             that engines.languagetool.url points at a LanguageTool server."
        )
    })
}

#[derive(serde::Deserialize)]
struct LanguageEntry {
    code: String,
    #[serde(rename = "longCode")]
    long_code: String,
}

/// Vale: the binary has to be on PATH, and the config file has to be readable.
///
/// Both are reported separately because the fixes are different -- one is an
/// install, the other is a path in this file.
async fn probe_vale(config: &Config) -> Vec<Probe> {
    const ENGINE: &str = "vale";
    if !config.engines.vale.enabled {
        return vec![Probe::new(
            "engines.vale",
            ENGINE,
            ProbeStatus::Skipped,
            "Vale is switched off.",
        )];
    }

    let mut probes = match binary_version("vale", &["--version"]).await {
        Ok(version) => vec![Probe::new(
            "engines.vale",
            ENGINE,
            ProbeStatus::Ok,
            format!("Found {version} on PATH."),
        )],
        Err(why) => {
            return vec![Probe::new("engines.vale", ENGINE, ProbeStatus::Down, why)];
        }
    };

    if let Some(path) = &config.engines.vale.config {
        probes.push(readable_file(
            "engines.vale.config",
            ENGINE,
            path,
            "Vale config",
        ));
    }
    probes
}

/// Proselint, on the same two questions as Vale.
async fn probe_proselint(config: &Config) -> Vec<Probe> {
    const ENGINE: &str = "proselint";
    if !config.engines.proselint.enabled {
        return vec![Probe::new(
            "engines.proselint",
            ENGINE,
            ProbeStatus::Skipped,
            "Proselint is switched off.",
        )];
    }

    let mut probes = match binary_version("proselint", &["--version"]).await {
        Ok(version) => vec![Probe::new(
            "engines.proselint",
            ENGINE,
            ProbeStatus::Ok,
            format!("Found {version} on PATH."),
        )],
        Err(why) => {
            return vec![Probe::new("engines.proselint", ENGINE, ProbeStatus::Down, why)];
        }
    };

    if let Some(path) = &config.engines.proselint.config {
        probes.push(readable_file(
            "engines.proselint.config",
            ENGINE,
            path,
            "Proselint config",
        ));
    }
    probes
}

/// Whether anything can actually spell-check the configured language.
///
/// Harper reads English only, so a workspace set to `de-DE` with Harper alone
/// is configured to check nothing -- which today produces a clean document
/// and no explanation.
async fn probe_spell_language(config: &Config, workspace_root: &Path) -> Vec<Probe> {
    let tag = config.engines.spell_language.clone();
    if tag.is_empty() {
        return vec![Probe::new(
            "engines.spell_language",
            "",
            ProbeStatus::Down,
            "engines.spell_language is empty. Set it to a BCP-47 tag such as en-US.",
        )];
    }

    let base = tag.split('-').next().unwrap_or(&tag).to_lowercase();
    let mut servers: Vec<String> = Vec::new();
    if config.engines.harper.enabled && base == "en" {
        servers.push("Harper".to_string());
    }
    if config.engines.languagetool.enabled {
        servers.push("LanguageTool".to_string());
    }

    if config.engines.hunspell.enabled {
        let search = config.engines.hunspell.search_paths.clone();
        let overrides = config.engines.hunspell.dictionary_paths.clone();
        let wanted = tag.clone();
        let root = workspace_root.to_path_buf();
        let resolved = tokio::task::spawn_blocking(move || {
            let mut registry = crate::packs::PackRegistry::new();
            for path in &search {
                registry = registry.with_search_path(absolute_against(&root, path));
            }
            for (language, path) in &overrides {
                registry = registry.with_override(language, absolute_against(&root, path));
            }
            registry.resolve(&wanted).is_ok()
        })
        .await
        .unwrap_or(false);
        if resolved {
            servers.push("Hunspell".to_string());
        }
    }

    if servers.is_empty() {
        return vec![Probe::new(
            "engines.spell_language",
            "",
            ProbeStatus::Down,
            format!(
                "Nothing enabled here checks \"{tag}\". Harper reads English only; enable \
                 LanguageTool or install a Hunspell dictionary for it."
            ),
        )];
    }

    vec![Probe::new(
        "engines.spell_language",
        "",
        ProbeStatus::Ok,
        format!("\"{tag}\" is checked by {}.", servers.join(" and ")),
    )]
}

fn absolute_against(root: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

/// Whether a path in the config names a file that can be opened.
fn readable_file(key: &str, engine: &str, path: &str, what: &str) -> Probe {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => Probe::new(
            key,
            engine,
            ProbeStatus::Down,
            format!("{path} is a directory, not a {what} file."),
        ),
        Ok(_) => match std::fs::File::open(path) {
            Ok(_) => Probe::new(key, engine, ProbeStatus::Ok, format!("Read {path}.")),
            Err(e) => Probe::new(
                key,
                engine,
                ProbeStatus::Down,
                format!("{path} exists but could not be opened: {e}"),
            ),
        },
        Err(_) => Probe::new(
            key,
            engine,
            ProbeStatus::Down,
            format!("No {what} at {path}."),
        ),
    }
}

/// Run `binary --version` and return the first line it prints.
///
/// The version is worth having in the hover: "found vale 3.7.1 on PATH"
/// answers a different question from "vale is installed", and the difference
/// matters when a config uses a style only newer versions ship.
async fn binary_version(binary: &str, args: &[&str]) -> Result<String, String> {
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let run = tokio::time::timeout(PROBE_TIMEOUT, command.output()).await;
    match run {
        Ok(Ok(output)) => {
            // Some print the version to stderr, some to stdout, and which one
            // is not worth depending on.
            let text = if output.stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).to_string()
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            let line = text.lines().next().unwrap_or("").trim().to_string();
            if line.is_empty() {
                Ok(binary.to_string())
            } else {
                Ok(line)
            }
        }
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Err(format!(
            "{binary} is not on PATH. Install it, or set engines.{binary}.enabled to false."
        )),
        Ok(Err(e)) => Err(format!("Could not run {binary}: {e}")),
        Err(_) => Err(format!(
            "{binary} did not answer within {}s.",
            PROBE_TIMEOUT.as_secs()
        )),
    }
}

/// The part of a `reqwest` error worth putting in front of a user.
///
/// The `Display` of a transport error is a chain that ends in the useful
/// sentence and begins with three that are not.
fn terse_reqwest_error(error: &reqwest::Error) -> String {
    let mut source: &dyn std::error::Error = error;
    let mut last = error.to_string();
    while let Some(next) = source.source() {
        last = next.to_string();
        source = next;
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Write;

    fn config_from(yaml: &str) -> Config {
        Config::parse_text(yaml, Path::new("/tmp"), "yaml").expect("fixture parses")
    }

    fn find<'a>(probes: &'a [Probe], key: &str) -> Option<&'a Probe> {
        probes.iter().find(|p| p.key == key)
    }

    /// A server that answers `/v2/languages` with `codes`, and 404 elsewhere.
    ///
    /// Written out rather than mocked because the probe's whole claim is that
    /// a real request reached a real socket; a stubbed client would leave the
    /// URL handling, the timeout and the JSON shape untested.
    async fn fake_languagetool(codes: &[(&str, &str)]) -> (String, tokio::task::JoinHandle<()>) {
        let body = format!(
            "[{}]",
            codes
                .iter()
                .map(|(code, long)| format!(
                    r#"{{"name":"Test","code":"{code}","longCode":"{long}"}}"#
                ))
                .collect::<Vec<_>>()
                .join(",")
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind an ephemeral port");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let handle = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buffer = vec![0u8; 2048];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let response = if request.contains("/v2/languages") {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                } else {
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        .to_string()
                };
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        (url, handle)
    }

    #[test]
    fn the_worst_of_two_outcomes_is_the_one_that_should_worry_the_reader() {
        assert_eq!(ProbeStatus::Ok.worst(ProbeStatus::Down), ProbeStatus::Down);
        assert_eq!(ProbeStatus::Down.worst(ProbeStatus::Ok), ProbeStatus::Down);
        assert_eq!(
            ProbeStatus::Degraded.worst(ProbeStatus::Ok),
            ProbeStatus::Degraded
        );
        assert_eq!(
            ProbeStatus::Down.worst(ProbeStatus::Degraded),
            ProbeStatus::Down
        );
        // Skipped loses to everything: an engine that is off contributes
        // nothing to a line that has something else to say.
        assert_eq!(ProbeStatus::Skipped.worst(ProbeStatus::Ok), ProbeStatus::Ok);
    }

    #[test]
    fn a_server_offering_a_bare_tag_serves_the_regional_one() {
        let served: BTreeSet<String> = ["en", "de-de"].iter().map(|s| (*s).to_string()).collect();
        assert!(serves(&served, "en-US"));
        assert!(serves(&served, "de-DE"));
        assert!(!serves(&served, "fr"));
        // Nothing asked for is nothing to complain about.
        assert!(serves(&served, ""));
    }

    #[tokio::test]
    async fn a_disabled_engine_is_skipped_and_not_called_broken() {
        let config = config_from("engines:\n  vale: false\n  proselint: false\n");
        let probes = probe_config(&config, Path::new("/tmp")).await;
        assert_eq!(
            find(&probes, "engines.vale").map(|p| p.status),
            Some(ProbeStatus::Skipped)
        );
        assert_eq!(
            find(&probes, "engines.proselint").map(|p| p.status),
            Some(ProbeStatus::Skipped)
        );
    }

    #[tokio::test]
    async fn harper_is_always_available_because_it_is_built_in() {
        let config = config_from("engines:\n  harper: true\n");
        let probes = probe_harper(&config).await;
        assert_eq!(
            find(&probes, "engines.harper").map(|p| p.status),
            Some(ProbeStatus::Ok)
        );
    }

    #[tokio::test]
    async fn a_misspelled_harper_linter_is_reported_against_its_own_key() {
        let mut config = config_from("engines:\n  harper: true\n");
        config
            .engines
            .harper
            .linters
            .insert("LongSentance".to_string(), false);
        let probes = probe_harper(&config).await;
        let probe = find(&probes, "engines.harper.linters.LongSentance")
            .expect("the unknown linter is reported");
        assert_eq!(probe.status, ProbeStatus::Down);
        assert!(probe.detail.contains("LongSentance"));
    }

    #[tokio::test]
    async fn a_real_harper_linter_is_not_reported() {
        let mut config = config_from("engines:\n  harper: true\n");
        let mut linters = HashMap::new();
        linters.insert("LongSentences".to_string(), false);
        config.engines.harper.linters = linters;
        let probes = probe_harper(&config).await;
        assert!(
            !probes
                .iter()
                .any(|p| p.key.starts_with("engines.harper.linters.")),
            "a linter Harper does have should produce nothing: {probes:#?}"
        );
    }

    #[tokio::test]
    async fn a_languagetool_url_that_is_not_a_url_is_reported_without_a_request() {
        let config = config_from(
            "engines:\n  languagetool:\n    enabled: true\n    url: \"localhost:8010\"\n",
        );
        let probes = probe_languagetool(&config).await;
        assert_eq!(
            find(&probes, "engines.languagetool.url").map(|p| p.status),
            Some(ProbeStatus::Down)
        );
    }

    #[tokio::test]
    async fn a_languagetool_that_answers_is_reported_with_what_it_serves() {
        let (url, server) = fake_languagetool(&[("en", "en-US")]).await;
        let config = config_from(&format!(
            "engines:\n  languagetool:\n    enabled: true\n    url: \"{url}\"\n  \
             spell_language: \"en-US\"\n"
        ));
        let probes = probe_languagetool(&config).await;
        server.abort();

        let block = find(&probes, "engines.languagetool").expect("the block is reported");
        assert_eq!(block.status, ProbeStatus::Ok);
        assert!(block.detail.contains("serving 1 languages"), "{}", block.detail);
        assert_eq!(
            find(&probes, "engines.languagetool.url").map(|p| p.status),
            Some(ProbeStatus::Ok)
        );
    }

    #[tokio::test]
    async fn a_languagetool_up_but_without_the_workspace_language_is_degraded() {
        let (url, server) = fake_languagetool(&[("de", "de-DE")]).await;
        let config = config_from(&format!(
            "engines:\n  languagetool:\n    enabled: true\n    url: \"{url}\"\n  \
             spell_language: \"en-US\"\n"
        ));
        let probes = probe_languagetool(&config).await;
        server.abort();

        // Reachability and usefulness are different answers, and the block
        // carries both: the reader needs to know it connected *and* that the
        // connection buys nothing here.
        assert!(
            probes
                .iter()
                .any(|p| p.key == "engines.languagetool" && p.status == ProbeStatus::Degraded),
            "{probes:#?}"
        );
    }

    #[tokio::test]
    async fn a_languagetool_that_refuses_the_connection_says_so_against_the_url() {
        // Bound and dropped, so the port is one nothing is listening on.
        let port = {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            listener.local_addr().unwrap().port()
        };
        let config = config_from(&format!(
            "engines:\n  languagetool:\n    enabled: true\n    \
             url: \"http://127.0.0.1:{port}\"\n"
        ));
        let probes = probe_languagetool(&config).await;
        let probe = find(&probes, "engines.languagetool.url").expect("the url is reported");
        assert_eq!(probe.status, ProbeStatus::Down);
        assert!(probe.detail.contains("v2/languages"), "{}", probe.detail);
    }

    #[test]
    fn a_config_path_that_does_not_exist_names_the_path() {
        let probe = readable_file(
            "engines.vale.config",
            "vale",
            "/definitely/not/here/.vale.ini",
            "Vale config",
        );
        assert_eq!(probe.status, ProbeStatus::Down);
        assert!(probe.detail.contains("/definitely/not/here/.vale.ini"));
    }

    #[test]
    fn a_config_path_that_is_a_directory_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");
        let probe = readable_file(
            "engines.vale.config",
            "vale",
            &dir.path().to_string_lossy(),
            "Vale config",
        );
        assert_eq!(probe.status, ProbeStatus::Down);
        assert!(probe.detail.contains("is a directory"));
    }

    #[test]
    fn a_readable_config_path_is_ok() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(".vale.ini");
        let mut file = std::fs::File::create(&path).expect("create");
        writeln!(file, "StylesPath = styles").expect("write");
        let probe = readable_file(
            "engines.vale.config",
            "vale",
            &path.to_string_lossy(),
            "Vale config",
        );
        assert_eq!(probe.status, ProbeStatus::Ok);
    }

    #[tokio::test]
    async fn harper_alone_cannot_serve_a_language_it_does_not_read() {
        let config = config_from("engines:\n  harper: true\n  spell_language: \"de-DE\"\n");
        let probes = probe_spell_language(&config, Path::new("/tmp")).await;
        let probe = find(&probes, "engines.spell_language").expect("reported");
        assert_eq!(probe.status, ProbeStatus::Down);
        assert!(probe.detail.contains("de-DE"), "{}", probe.detail);
    }

    #[tokio::test]
    async fn harper_serves_english_on_its_own() {
        let config = config_from("engines:\n  harper: true\n  spell_language: \"en-GB\"\n");
        let probes = probe_spell_language(&config, Path::new("/tmp")).await;
        let probe = find(&probes, "engines.spell_language").expect("reported");
        assert_eq!(probe.status, ProbeStatus::Ok);
        assert!(probe.detail.contains("Harper"), "{}", probe.detail);
    }

    #[tokio::test]
    async fn an_empty_spell_language_is_reported_as_such() {
        let config = config_from("engines:\n  spell_language: \"\"\n");
        let probes = probe_spell_language(&config, Path::new("/tmp")).await;
        assert_eq!(
            find(&probes, "engines.spell_language").map(|p| p.status),
            Some(ProbeStatus::Down)
        );
    }

    #[tokio::test]
    async fn a_missing_binary_is_reported_as_an_install_not_a_config_error() {
        let error = binary_version("definitely-not-a-real-binary-xyz", &["--version"])
            .await
            .expect_err("a missing binary is an error");
        assert!(error.contains("not on PATH"), "{error}");
    }
}

