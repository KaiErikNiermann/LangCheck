//! The browser extension's way into the core: a native messaging host.
//!
//! Browsers talk to a native host in JSON, each message prefixed with its
//! length as a native-endian `u32`. The core server talks length-prefixed
//! (big-endian) protobuf. This host sits between the two and does three
//! things, and nothing else:
//!
//! - **Framing.** A browser message is `{"frame": "<base64 Request>"}`. A
//!   response goes back as one or more `{"frame": "<base64 segment>", "more":
//!   bool}` messages, because a browser accepts at most 1 MiB per message
//!   from a host and a large document's findings can exceed that.
//! - **Policy.** The requests come from an extension that runs next to
//!   untrusted pages, so the host decodes every request and lets through only
//!   what a web document needs. It strips anything that names a file
//!   (`file_path`, `db_path`, `dictionaries_paths`), turns the workspace root
//!   into a sanitised key under the host's own data directory, caps the text
//!   size, and refuses config probing. A page that manages to drive the
//!   extension can make the core check text and learn words, but it can't
//!   make it read or write anywhere else.
//! - **Lifetime.** It spawns the server as a child, ends it when the browser
//!   closes the port (stdin EOF), and exits when the server does, so the
//!   extension sees a disconnect and can start a fresh one.
//!
//! Everything the checker does stays in the server: one implementation of
//! checking, caching, dictionaries and suppression for VS Code and the web.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use prost::Message as _;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::checker::{ErrorResponse, Request, Response, request, response};

/// The name browsers know the host by (`connectNative(HOST_NAME)`).
pub const HOST_NAME: &str = "language_check";

/// The Firefox add-on id the host manifest admits.
pub const FIREFOX_EXTENSION_ID: &str = "language-check@kaierikniermann.github.io";

/// Largest message accepted from the browser. A request carries one
/// document's text; Overleaf caps a file at 2 MiB of text, base64 adds a
/// third, and JSON a little more.
pub const MAX_BROWSER_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

/// Largest text a check may carry, after decoding.
pub const MAX_CHECK_TEXT_BYTES: usize = 4 * 1024 * 1024;

/// Largest response the host relays. The extension refuses more than 64 MiB
/// of base64 (48 MiB decoded) anyway, so a larger frame is dropped here
/// rather than buffered, encoded and sent to be refused.
pub const MAX_SERVER_FRAME_BYTES: usize = 48 * 1024 * 1024;

/// Base64 characters per message to the browser.
///
/// Browsers refuse anything over 1 MiB from a host; this leaves room for the
/// JSON around it. A multiple of 4, so segments split on base64 boundaries.
pub const SEGMENT_CHARS: usize = 768 * 1024;

/// Responses decoded and waiting for the browser before the server's reader
/// waits. Small, because each may be up to `MAX_SERVER_FRAME_BYTES`: this
/// bounds what the host holds at about 4 x 48 MiB plus the one being encoded.
const OUTBOX_CAPACITY: usize = 4;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrowserMessage {
    frame: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct HostMessage {
    pub frame: String,
    pub more: bool,
}

/// A workspace named by the extension, confined to the host's data directory.
///
/// The extension sends a key such as `overleaf-691fc133…`, never a path. The
/// key must be 1–128 characters of `[A-Za-z0-9._-]` and must not start with
/// a dot, so it can't be `..`, hidden, absolute, or contain a separator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceKey(String);

impl WorkspaceKey {
    pub fn parse(raw: &str) -> Result<Self> {
        let valid = (1..=128).contains(&raw.len())
            && !raw.starts_with('.')
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if !valid {
            bail!("workspace key must be 1-128 of [A-Za-z0-9._-] and not start with '.'");
        }
        Ok(Self(raw.to_owned()))
    }

    #[must_use]
    pub fn dir_under(&self, root: &Path) -> PathBuf {
        root.join(&self.0)
    }
}

/// Where web workspaces live: `<data dir>/language-check/web/<key>/`.
pub fn default_web_root() -> Result<PathBuf> {
    Ok(dirs::data_dir()
        .context("no user data directory on this system")?
        .join("language-check")
        .join("web"))
}

/// What the host lets through, after rewriting. `Err` carries the message
/// sent back to the extension under the request's id.
pub fn admit(mut req: Request, web_root: &Path) -> Result<Request, String> {
    match req.payload.as_mut() {
        Some(request::Payload::Initialize(init)) => {
            let key = WorkspaceKey::parse(&init.workspace_root).map_err(|e| e.to_string())?;
            let dir = key.dir_under(web_root);
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("cannot create the workspace directory: {e}"))?;
            init.workspace_root = dir.to_string_lossy().into_owned();
            init.db_path = None;
            init.dictionaries_paths.clear();
            init.index_on_open = Some(false);
        }
        Some(request::Payload::CheckProse(check)) => {
            if check.text.len() > MAX_CHECK_TEXT_BYTES {
                return Err(format!(
                    "text is {} bytes; the web host checks at most {MAX_CHECK_TEXT_BYTES}",
                    check.text.len()
                ));
            }
            check.file_path = None;
        }
        Some(
            request::Payload::AddDictionaryWord(_)
            | request::Payload::Ignore(_)
            | request::Payload::GetMetadata(_),
        ) => {}
        // The config page's requests. The extension sends them only for its
        // own config page, never for a web page (a probe fetches URLs and
        // looks at files, the text may hold an API key); here they are held
        // to the workspace and a size, and their answers are scrubbed of
        // paths on the way out (`scrub`).
        Some(request::Payload::ReadConfig(_) | request::Payload::ListConfigFiles(_)) => {}
        Some(request::Payload::WriteConfig(write)) => {
            if write.text.len() > crate::config::Config::MAX_TEXT_BYTES {
                return Err(format!(
                    "the config is {} bytes; the web host writes at most {}",
                    write.text.len(),
                    crate::config::Config::MAX_TEXT_BYTES
                ));
            }
            // Checked as both formats: the server loads whichever config file
            // exists, which the host cannot see, and YAML reads JSON too.
            confined(&write.text, &["yaml", "json"])?;
        }
        Some(request::Payload::ProbeConfig(probe)) => {
            if probe.text.len() > crate::config::Config::MAX_TEXT_BYTES {
                return Err(format!(
                    "the config is {} bytes; the web host probes at most {}",
                    probe.text.len(),
                    crate::config::Config::MAX_TEXT_BYTES
                ));
            }
            // A probe stats every file the config names and fetches its
            // URLs, so the same confinement holds for what is probed.
            confined(
                &probe.text,
                &[if probe.format.eq_ignore_ascii_case("json") {
                    "json"
                } else {
                    "yaml"
                }],
            )?;
            // Resolved against the workspace, as the server does with none.
            probe.file_path = None;
        }
        None => return Err("request has no payload".into()),
    }
    Ok(req)
}

/// `Err` naming every key of `text` a browser workspace's config may not
/// hold (Config::web_confinement_violations), in any of `formats`.
fn confined(text: &str, formats: &[&str]) -> Result<(), String> {
    let mut violations: Vec<String> = formats
        .iter()
        .flat_map(|format| crate::config::Config::web_confinement_violations(text, format))
        .collect();
    violations.sort();
    violations.dedup();
    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations.join(" "))
    }
}

/// Rewrites what an answer says about where things are: the workspace
/// directory becomes `.`, the home directory `~`. The extension shows these
/// answers in web pages, which have no business knowing the user's paths.
pub fn scrub(response: &mut Response, workspace: Option<&Path>) {
    let home = dirs::home_dir();
    let rewrite = |text: &mut String| {
        if let Some(dir) = workspace.and_then(Path::to_str).filter(|d| !d.is_empty()) {
            *text = text.replace(dir, ".");
        }
        if let Some(home) = home
            .as_deref()
            .and_then(Path::to_str)
            .filter(|h| h.len() > 1)
        {
            *text = text.replace(home, "~");
        }
    };
    match response.payload.as_mut() {
        Some(response::Payload::ProbeConfig(probe)) => {
            rewrite(&mut probe.parse_error);
            for each in &mut probe.probes {
                rewrite(&mut each.detail);
            }
            for issue in &mut probe.issues {
                rewrite(&mut issue.message);
            }
        }
        Some(response::Payload::ListConfigFiles(listing)) => {
            // A name, not a path: the file is always the workspace's own.
            listing.config_path = Path::new(&listing.config_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned();
            rewrite(&mut listing.load_error);
        }
        Some(response::Payload::Error(error)) => rewrite(&mut error.message),
        // An engine's failure ("could not start /home/u/bin/vale") reaches
        // the page as its health and as a finding about the unchecked text.
        Some(response::Payload::CheckProse(check)) => {
            for health in &mut check.engine_health {
                rewrite(&mut health.last_error);
            }
            for diagnostic in &mut check.diagnostics {
                rewrite(&mut diagnostic.message);
            }
        }
        _ => {}
    }
}

/// The id of a request the host refused, for the error it sends back.
const fn error_response(id: u64, message: String) -> Response {
    Response {
        id,
        payload: Some(response::Payload::Error(ErrorResponse { message })),
    }
}

/// Reads one browser message: a native-endian `u32` length, then that many
/// bytes. `Ok(None)` on a clean EOF between messages.
pub async fn read_browser_message<R: AsyncRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_ne_bytes(len) as usize;
    if len > max {
        bail!("browser message of {len} bytes exceeds the {max}-byte cap");
    }
    let mut body = vec![0u8; len];
    reader
        .read_exact(&mut body)
        .await
        .context("browser message truncated")?;
    Ok(Some(body))
}

pub async fn write_browser_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    message: &HostMessage,
) -> Result<()> {
    let body = serde_json::to_vec(message)?;
    let len = u32::try_from(body.len()).context("host message too long")?;
    writer.write_all(&len.to_ne_bytes()).await?;
    writer.write_all(&body).await?;
    writer.flush().await?;
    Ok(())
}

/// Splits an encoded response into messages the browser will accept.
#[must_use]
pub fn segments(response: &Response) -> Vec<HostMessage> {
    let encoded = BASE64.encode(response.encode_to_vec());
    if encoded.is_empty() {
        return vec![HostMessage {
            frame: String::new(),
            more: false,
        }];
    }
    let chunks: Vec<&str> = encoded
        .as_bytes()
        .chunks(SEGMENT_CHARS)
        // Base64 is ASCII, so every byte boundary is a char boundary.
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect();
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(i, frame)| HostMessage {
            frame: frame.to_owned(),
            more: i != last,
        })
        .collect()
}

/// Decodes a browser message into a request, or the error to answer with.
/// The id is recovered on a best-effort basis so the extension can match the
/// error to its pending call.
pub fn decode_browser_message(body: &[u8]) -> Result<Request, (u64, String)> {
    let message: BrowserMessage =
        serde_json::from_slice(body).map_err(|e| (0, format!("malformed message: {e}")))?;
    let bytes = BASE64
        .decode(message.frame.as_bytes())
        .map_err(|e| (0, format!("frame is not base64: {e}")))?;
    Request::decode(bytes.as_slice()).map_err(|e| {
        let id = crate::wire::leading_request_id(&bytes).unwrap_or(0);
        (id, format!("frame is not a request: {e}"))
    })
}

async fn write_server_frame<W: AsyncWrite + Unpin>(writer: &mut W, req: &Request) -> Result<()> {
    let body = req.encode_to_vec();
    let len = u32::try_from(body.len()).context("request too long")?;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&body).await?;
    writer.flush().await?;
    Ok(())
}

async fn read_server_frame<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<Response>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_SERVER_FRAME_BYTES {
        bail!("server frame of {len} bytes exceeds the cap; the stream lost its framing");
    }
    let mut body = vec![0u8; len];
    reader
        .read_exact(&mut body)
        .await
        .context("server frame truncated")?;
    Ok(Some(Response::decode(body.as_slice())?))
}

/// The server binary next to this one, as installed.
pub fn sibling_server() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("cannot locate the host binary")?;
    let dir = exe.parent().context("host binary has no directory")?;
    let name = if cfg!(windows) {
        "language-check-server.exe"
    } else {
        "language-check-server"
    };
    Ok(dir.join(name))
}

fn spawn_server(server: &Path, web_root: &Path) -> Result<tokio::process::Child> {
    std::fs::create_dir_all(web_root)
        .with_context(|| format!("cannot create {}", web_root.display()))?;
    tokio::process::Command::new(server)
        .current_dir(web_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The browser shows a host's stderr in its console; the server logs there.
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("cannot start {}", server.display()))
}

/// Runs the host over the given browser streams until either side closes.
pub async fn run<R, W>(server: &Path, web_root: &Path, browser_in: R, browser_out: W) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut child = spawn_server(server, web_root)?;
    let mut server_in = child.stdin.take().context("server stdin")?;
    let mut server_out = child.stdout.take().context("server stdout")?;
    info!(server = %server.display(), "native host started");

    // One writer owns the browser's stdout; both directions feed it.
    let (outbox, mut outbox_rx) = mpsc::channel::<Response>(OUTBOX_CAPACITY);
    let writer = tokio::spawn(async move {
        let mut browser_out = browser_out;
        while let Some(response) = outbox_rx.recv().await {
            for message in segments(&response) {
                write_browser_message(&mut browser_out, &message).await?;
            }
        }
        anyhow::Ok(())
    });

    // The workspace this connection initialized, for scrubbing answers.
    let workspace: std::sync::Arc<std::sync::Mutex<Option<PathBuf>>> = std::sync::Arc::default();

    let to_browser = {
        let outbox = outbox.clone();
        let workspace = std::sync::Arc::clone(&workspace);
        tokio::spawn(async move {
            while let Some(mut response) = read_server_frame(&mut server_out).await? {
                let dir = workspace.lock().map(|dir| dir.clone()).unwrap_or_default();
                scrub(&mut response, dir.as_deref());
                if outbox.send(response).await.is_err() {
                    break;
                }
            }
            anyhow::Ok(())
        })
    };

    let web_root = web_root.to_owned();
    let to_server = tokio::spawn(async move {
        let mut browser_in = browser_in;
        while let Some(body) =
            read_browser_message(&mut browser_in, MAX_BROWSER_MESSAGE_BYTES).await?
        {
            let refusal = match decode_browser_message(&body) {
                Ok(req) => {
                    let id = req.id;
                    match admit(req, &web_root) {
                        Ok(req) => {
                            if let Some(request::Payload::Initialize(init)) = &req.payload
                                && let Ok(mut dir) = workspace.lock()
                            {
                                *dir = Some(PathBuf::from(&init.workspace_root));
                            }
                            write_server_frame(&mut server_in, &req).await?;
                            None
                        }
                        Err(message) => Some((id, message)),
                    }
                }
                Err(refusal) => Some(refusal),
            };
            if let Some((id, message)) = refusal {
                warn!(id, %message, "refused a request");
                if outbox.send(error_response(id, message)).await.is_err() {
                    break;
                }
            }
        }
        // Browser closed the port: closing the server's stdin ends it.
        drop(server_in);
        anyhow::Ok(())
    });

    // Whichever direction ends first decides; the server exiting (crash or
    // EOF) ends the host so the extension sees the port close. The other
    // direction is aborted, or a browser that keeps its port open would hold
    // the host (and its sender, and so the writer) forever.
    let (mut to_server, mut to_browser) = (to_server, to_browser);
    let outcome = tokio::select! {
        r = &mut to_server => { to_browser.abort(); r.context("browser reader panicked")? }
        r = &mut to_browser => { to_server.abort(); r.context("server reader panicked")? }
    };
    let status = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
    match status {
        Ok(Ok(status)) if !status.success() => warn!(%status, "server exited"),
        Ok(Err(e)) => warn!("waiting for the server: {e}"),
        Err(_) => {
            warn!("server still running 5s after the port closed; killing it");
            child.kill().await.ok();
        }
        Ok(Ok(_)) => {}
    }
    // Both senders are gone now (one task finished, the other was aborted),
    // so the writer drains what is queued and ends.
    writer.await.context("browser writer panicked")??;
    outcome
}

/// The host manifest a browser reads to find this binary.
pub fn manifest(
    host_path: &Path,
    browser: Browser,
    chrome_extension_id: Option<&str>,
) -> Result<serde_json::Value> {
    let path = host_path.to_string_lossy();
    let description = "LangCheck: prose checking for web editors";
    Ok(match browser {
        Browser::Firefox => serde_json::json!({
            "name": HOST_NAME,
            "description": description,
            "path": path,
            "type": "stdio",
            "allowed_extensions": [FIREFOX_EXTENSION_ID],
        }),
        Browser::Chrome | Browser::Chromium => {
            let id = chrome_extension_id.context("Chrome needs --chrome-extension-id")?;
            if id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
                bail!("a Chrome extension id is 32 letters a-p");
            }
            serde_json::json!({
                "name": HOST_NAME,
                "description": description,
                "path": path,
                "type": "stdio",
                "allowed_origins": [format!("chrome-extension://{id}/")],
            })
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Browser {
    Firefox,
    Chrome,
    Chromium,
}

/// Where a browser looks for user-level host manifests.
pub fn manifest_dir(browser: Browser) -> Result<PathBuf> {
    let home = dirs::home_dir().context("no home directory")?;
    let config = dirs::config_dir().context("no config directory")?;
    Ok(match (browser, cfg!(target_os = "macos")) {
        (Browser::Firefox, false) => home.join(".mozilla/native-messaging-hosts"),
        (Browser::Firefox, true) => {
            home.join("Library/Application Support/Mozilla/NativeMessagingHosts")
        }
        (Browser::Chrome, false) => config.join("google-chrome/NativeMessagingHosts"),
        (Browser::Chrome, true) => {
            home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        }
        (Browser::Chromium, false) => config.join("chromium/NativeMessagingHosts"),
        (Browser::Chromium, true) => {
            home.join("Library/Application Support/Chromium/NativeMessagingHosts")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checker::{CheckRequest, InitializeRequest, ProbeConfigRequest};

    fn request(payload: request::Payload) -> Request {
        Request {
            id: 7,
            payload: Some(payload),
        }
    }

    #[test]
    fn keys_that_could_escape_the_web_root_are_refused() {
        for bad in [
            "",
            ".",
            "..",
            ".hidden",
            "a/b",
            "a\\b",
            "/abs",
            "a b",
            "é",
            &"x".repeat(129),
        ] {
            assert!(WorkspaceKey::parse(bad).is_err(), "{bad:?} was accepted");
        }
        for good in [
            "overleaf-691fc1336049c31a479401d0",
            "typst-pyfJbNtagVZWDPWs5i1S1O",
            "a",
            "a.b_c-d",
        ] {
            assert!(WorkspaceKey::parse(good).is_ok(), "{good:?} was refused");
        }
    }

    #[test]
    fn initialize_is_confined_to_the_web_root_and_stripped_of_paths() {
        let root = tempfile::tempdir().unwrap();
        let admitted = admit(
            request(request::Payload::Initialize(InitializeRequest {
                workspace_root: "overleaf-abc".into(),
                db_path: Some("/etc/passwd".into()),
                dictionaries_paths: vec!["/home/user/.ssh/id_rsa".into()],
                index_on_open: Some(true),
                ..Default::default()
            })),
            root.path(),
        )
        .unwrap();
        let Some(request::Payload::Initialize(init)) = admitted.payload else {
            panic!()
        };
        assert_eq!(
            Path::new(&init.workspace_root),
            root.path().join("overleaf-abc")
        );
        assert!(root.path().join("overleaf-abc").is_dir());
        assert_eq!(init.db_path, None);
        assert!(init.dictionaries_paths.is_empty());
        assert_eq!(init.index_on_open, Some(false));
    }

    #[test]
    fn a_path_as_workspace_root_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let refused = admit(
            request(request::Payload::Initialize(InitializeRequest {
                workspace_root: "/home/user".into(),
                ..Default::default()
            })),
            root.path(),
        );
        assert!(refused.is_err());
    }

    #[test]
    fn checks_lose_their_file_path_and_oversized_text_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let admitted = admit(
            request(request::Payload::CheckProse(CheckRequest {
                text: "teh".into(),
                file_path: Some("/etc/hosts".into()),
                ..Default::default()
            })),
            root.path(),
        )
        .unwrap();
        let Some(request::Payload::CheckProse(check)) = admitted.payload else {
            panic!()
        };
        assert_eq!(check.file_path, None);

        let huge = admit(
            request(request::Payload::CheckProse(CheckRequest {
                text: "a".repeat(MAX_CHECK_TEXT_BYTES + 1),
                ..Default::default()
            })),
            root.path(),
        );
        assert!(huge.is_err());
    }

    #[test]
    fn config_requests_are_admitted_within_bounds_and_empty_ones_refused() {
        let root = tempfile::tempdir().unwrap();
        let admitted = admit(
            request(request::Payload::ProbeConfig(ProbeConfigRequest {
                text: "engines:\n  harper: true\n".into(),
                file_path: Some("/etc/elsewhere/.languagecheck.yaml".into()),
                format: String::new(),
            })),
            root.path(),
        )
        .unwrap();
        // Resolved against the workspace, never a path the extension names.
        assert!(
            matches!(admitted.payload, Some(request::Payload::ProbeConfig(ref probe)) if probe.file_path.is_none())
        );
        for payload in [
            request::Payload::ReadConfig(crate::checker::ReadConfigRequest {}),
            request::Payload::WriteConfig(crate::checker::WriteConfigRequest {
                text: "engines: {}\n".into(),
            }),
            request::Payload::ListConfigFiles(crate::checker::ListConfigFilesRequest {}),
        ] {
            assert!(admit(request(payload), root.path()).is_ok());
        }
        let huge = "#".repeat(crate::config::Config::MAX_TEXT_BYTES + 1);
        assert!(
            admit(
                request(request::Payload::WriteConfig(
                    crate::checker::WriteConfigRequest { text: huge.clone() }
                )),
                root.path()
            )
            .is_err()
        );
        assert!(
            admit(
                request(request::Payload::ProbeConfig(ProbeConfigRequest {
                    text: huge,
                    ..Default::default()
                })),
                root.path()
            )
            .is_err()
        );
        assert!(
            admit(
                Request {
                    id: 1,
                    payload: None
                },
                root.path()
            )
            .is_err()
        );
    }

    #[test]
    fn a_config_that_would_run_code_or_reach_outside_is_neither_written_nor_probed() {
        let root = tempfile::tempdir().unwrap();
        let write = |text: &str| {
            admit(
                request(request::Payload::WriteConfig(
                    crate::checker::WriteConfigRequest { text: text.into() },
                )),
                root.path(),
            )
        };
        assert!(write("engines:\n  harper: false\n").is_ok());
        let refused =
            write("engines:\n  external:\n    - name: x\n      command: /bin/sh\n").unwrap_err();
        assert!(refused.contains("engines.external"), "{refused}");
        // JSON is checked too, whatever the file in force turns out to be.
        assert!(write("{\"workspace\": {\"db_path\": \"/tmp/x.db\"}}").is_err());
        let probe = admit(
            request(request::Payload::ProbeConfig(ProbeConfigRequest {
                text: "engines:\n  vale:\n    config: /etc/shadow\n".into(),
                ..Default::default()
            })),
            root.path(),
        )
        .unwrap_err();
        assert!(probe.contains("engines.vale.config"), "{probe}");
    }

    #[test]
    fn check_answers_are_scrubbed_too() {
        let mut check = Response {
            id: 5,
            payload: Some(response::Payload::CheckProse(crate::checker::CheckResponse {
                engine_health: vec![crate::checker::EngineHealth {
                    last_error: "could not start /data/language-check/web/overleaf-p1/bin/vale".into(),
                    ..Default::default()
                }],
                diagnostics: vec![crate::checker::Diagnostic {
                    message: "This passage went unchecked: /data/language-check/web/overleaf-p1/x failed".into(),
                    ..Default::default()
                }],
                ..Default::default()
            })),
        };
        scrub(
            &mut check,
            Some(Path::new("/data/language-check/web/overleaf-p1")),
        );
        let Some(response::Payload::CheckProse(check)) = check.payload else {
            panic!("a check")
        };
        assert_eq!(
            check.engine_health[0].last_error,
            "could not start ./bin/vale"
        );
        assert_eq!(
            check.diagnostics[0].message,
            "This passage went unchecked: ./x failed"
        );
    }

    #[test]
    fn answers_are_scrubbed_of_the_workspace_and_home_paths() {
        let home = dirs::home_dir().unwrap_or_default();
        let workspace = Path::new("/data/language-check/web/overleaf-p1");
        let mut probe = Response {
            id: 3,
            payload: Some(response::Payload::ProbeConfig(
                crate::checker::ProbeConfigResponse {
                    probes: vec![crate::checker::ConfigProbe {
                        detail: "no .vale.ini in /data/language-check/web/overleaf-p1/styles"
                            .into(),
                        ..Default::default()
                    }],
                    parse_error: format!("cannot read {}/secret.yaml", home.display()),
                    ..Default::default()
                },
            )),
        };
        scrub(&mut probe, Some(workspace));
        let Some(response::Payload::ProbeConfig(probe)) = probe.payload else {
            panic!("a probe")
        };
        assert_eq!(probe.probes[0].detail, "no .vale.ini in ./styles");
        if home.as_os_str().len() > 1 {
            assert_eq!(probe.parse_error, "cannot read ~/secret.yaml");
        }
        let mut listing = Response {
            id: 4,
            payload: Some(response::Payload::ListConfigFiles(
                crate::checker::ListConfigFilesResponse {
                    config_path: "/data/language-check/web/overleaf-p1/.languagecheck.yaml".into(),
                    ..Default::default()
                },
            )),
        };
        scrub(&mut listing, Some(workspace));
        assert!(
            matches!(listing.payload, Some(response::Payload::ListConfigFiles(ref l)) if l.config_path == ".languagecheck.yaml")
        );
    }

    #[test]
    fn large_responses_split_into_segments_that_rejoin() {
        let response = Response {
            id: 3,
            payload: Some(response::Payload::Error(ErrorResponse {
                message: "x".repeat(2 * SEGMENT_CHARS),
            })),
        };
        let parts = segments(&response);
        assert!(parts.len() > 1);
        assert!(
            parts
                .iter()
                .all(|p| p.frame.len() <= SEGMENT_CHARS && p.frame.len() % 4 == 0)
        );
        assert_eq!(parts.iter().filter(|p| !p.more).count(), 1);
        assert!(!parts.last().unwrap().more);
        let joined: String = parts.iter().map(|p| p.frame.as_str()).collect();
        let decoded = Response::decode(BASE64.decode(joined).unwrap().as_slice()).unwrap();
        assert_eq!(decoded, response);
    }

    #[tokio::test]
    async fn browser_framing_round_trips_and_rejects_oversized_lengths() {
        let mut buf = Vec::new();
        let message = HostMessage {
            frame: "AAAA".into(),
            more: false,
        };
        write_browser_message(&mut buf, &message).await.unwrap();
        let read = read_browser_message(&mut buf.as_slice(), 1024)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&read).unwrap()["frame"],
            "AAAA"
        );

        let mut eof: &[u8] = &[];
        assert!(
            read_browser_message(&mut eof, 1024)
                .await
                .unwrap()
                .is_none()
        );

        let mut huge: &[u8] = &u32::MAX.to_ne_bytes();
        assert!(read_browser_message(&mut huge, 1024).await.is_err());

        let mut truncated: Vec<u8> = 10u32.to_ne_bytes().to_vec();
        truncated.extend_from_slice(b"abc");
        assert!(
            read_browser_message(&mut truncated.as_slice(), 1024)
                .await
                .is_err()
        );
    }

    #[test]
    fn malformed_browser_messages_are_refused_not_fatal() {
        for body in [
            &b"not json"[..],
            br#"{"frame": "!!"}"#,
            br#"{"frame": "AAAA", "x": 1}"#,
            br#"{"frame": "/w=="}"#,
        ] {
            assert!(
                decode_browser_message(body).is_err(),
                "{}",
                String::from_utf8_lossy(body)
            );
        }
        let mut broken = Request {
            id: 300,
            payload: None,
        }
        .encode_to_vec();
        broken.extend_from_slice(&[0x12, 0x7f, 0x01]);
        let broken = BASE64.encode(broken);
        assert_eq!(
            decode_browser_message(format!(r#"{{"frame":"{broken}"}}"#).as_bytes())
                .unwrap_err()
                .0,
            300
        );
        let ok = BASE64.encode(
            Request {
                id: 9,
                payload: None,
            }
            .encode_to_vec(),
        );
        assert_eq!(
            decode_browser_message(format!(r#"{{"frame":"{ok}"}}"#).as_bytes())
                .unwrap()
                .id,
            9
        );
    }

    #[test]
    fn chrome_manifests_need_a_well_formed_extension_id() {
        let path = Path::new("/usr/bin/language-check-native-host");
        assert!(manifest(path, Browser::Chrome, None).is_err());
        assert!(manifest(path, Browser::Chrome, Some("not-an-id")).is_err());
        let ok = manifest(path, Browser::Chromium, Some(&"a".repeat(32))).unwrap();
        assert_eq!(
            ok["allowed_origins"][0],
            format!("chrome-extension://{}/", "a".repeat(32))
        );
        assert_eq!(
            manifest(path, Browser::Firefox, None).unwrap()["allowed_extensions"][0],
            FIREFOX_EXTENSION_ID
        );
    }
}
