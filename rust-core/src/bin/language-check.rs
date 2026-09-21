#![warn(clippy::pedantic, clippy::nursery)]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::cast_possible_truncation,
    clippy::significant_drop_tightening
)]

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use config::Config;
use console::style;
use glob::glob;
use indicatif::{ProgressBar, ProgressStyle};
use lang_check::dictionary::Dictionary;
use lang_check::morphology::AffixAnalyzer;
use lang_check::names::NameFilter;
use lang_check::orchestrator::CheckContext;
use lang_check::packs::{self, PackRegistry, catalogue};
use lang_check::sls::SchemaRegistry;
use lang_check::suppression::{InlineDirectives, SuppressionContext, retain_visible};
use lang_check::text_util::snap_range;
use lang_check::{checker::Diagnostic, checker::Severity, config, orchestrator, prose, rules};
use orchestrator::Orchestrator;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "language-check", version)]
#[command(about = "Standalone CLI for the Ultimate Language Checker", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check a file or directory for language issues
    Check {
        /// Path to file or directory
        path: PathBuf,
        /// Language ID (auto-detected from extension if omitted)
        #[arg(short, long)]
        lang: Option<String>,
        /// Output format
        #[arg(short, long, default_value = "pretty")]
        format: OutputFormat,
    },
    /// Fix a file by applying high-confidence suggestions
    Fix {
        /// Path to file
        path: PathBuf,
        /// Language ID (auto-detected from extension if omitted)
        #[arg(short, long)]
        lang: Option<String>,
    },
    /// List all available grammar rules across providers
    ListRules {
        /// Filter by unified category prefix (e.g. "spelling", "grammar.article")
        #[arg(short, long)]
        filter: Option<String>,
        /// Filter by provider name (e.g. "harper", "languagetool")
        #[arg(short, long)]
        provider: Option<String>,
        /// Output format
        #[arg(long, default_value = "pretty")]
        format: OutputFormat,
    },
    /// Inspect or generate configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Manage Hunspell dictionary packs
    Packs {
        #[command(subcommand)]
        action: PackAction,
    },
}

#[derive(Clone, Subcommand)]
enum PackAction {
    /// Show which packs are installed and where they were found
    List,
    /// Show which languages have a published download
    Available,
    /// Download and install a pack
    Install {
        /// BCP-47 tag, e.g. `he`
        language: String,
        /// Install here instead of the user data directory
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    /// Check an installed pack without installing anything
    Verify {
        /// BCP-47 tag, e.g. `he`
        language: String,
    },
}

#[derive(Clone, Subcommand)]
enum ConfigAction {
    /// Show the current effective configuration
    Show,
    /// Generate a default .languagecheck.json in the current directory
    Init,
    /// List the files this config selects for checking
    Files {
        /// Also list the files that were skipped, and which pattern did it
        #[arg(long)]
        skipped: bool,
        /// Print paths only, one per line, for piping into another command
        #[arg(long)]
        bare: bool,
        /// Where to look. Defaults to the workspace root.
        #[arg(default_value = ".")]
        path: PathBuf,
    },
}

#[derive(Clone, ValueEnum)]
enum OutputFormat {
    Pretty,
    Json,
}

#[derive(Serialize)]
struct JsonDiagnostic {
    file: String,
    line: usize,
    column: usize,
    rule_id: String,
    unified_id: String,
    message: String,
    severity: String,
    suggestions: Vec<String>,
}

impl JsonDiagnostic {
    fn from_diagnostic(d: &Diagnostic, file: &str, text: &str, byte_offset: usize) -> Self {
        let (line, column) = get_line_col(text, byte_offset);
        // Matched on the enum, not on the numbers. Written out by hand these
        // were `1 => "error"` and `3 => "information"`, which is the enum
        // backwards -- SEVERITY_INFORMATION is 1 and SEVERITY_ERROR is 3 --
        // so every error in `--format json` was labelled information and
        // every information an error. The LSP path got it right, so a Neovim
        // user saw the correct severity and anyone parsing this JSON in CI did
        // not.
        let severity = match Severity::try_from(d.severity) {
            Ok(Severity::Error) => "error",
            Ok(Severity::Warning) => "warning",
            Ok(Severity::Information) => "information",
            Ok(Severity::Hint) => "hint",
            Ok(Severity::Unspecified) | Err(_) => "unknown",
        };
        Self {
            file: file.to_string(),
            line,
            column,
            rule_id: d.rule_id.clone(),
            unified_id: d.unified_id.clone(),
            message: d.message.clone(),
            severity: severity.to_string(),
            suggestions: d.suggestions.clone(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let current_dir = std::env::current_dir()?;
    // Config loading reports deprecated and unrecognised keys through `warn!`, which needs a
    // subscriber to go anywhere. It writes to stderr, so `--format json` on stdout stays clean.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .with_target(false)
        .without_time()
        .init();
    let config = Config::load(&current_dir).unwrap_or_else(|e| {
        eprintln!("lang-check: ignoring unreadable .languagecheck.yaml, using defaults: {e}");
        Config::default()
    });

    match cli.command {
        Commands::Check { path, lang, format } => {
            let schema_registry = SchemaRegistry::from_workspace(&current_dir)?;
            let pinned = lang.map(|l| lang_check::languages::resolve_language_id(&l).to_string());
            let suppression = CliSuppression::load(&current_dir, &config);
            check_path(
                path,
                pinned,
                &format,
                config,
                &schema_registry,
                &suppression,
            )
            .await?;
        }
        Commands::Fix { path, lang } => {
            let schema_registry = SchemaRegistry::from_workspace(&current_dir)?;
            let lang = lang.map_or_else(
                || lang_check::languages::detect_language(&path, &config),
                |l| lang_check::languages::resolve_language_id(&l).to_string(),
            );
            let suppression = CliSuppression::load(&current_dir, &config);
            fix_path(path, lang, config, &schema_registry, &suppression).await?;
        }
        Commands::ListRules {
            filter,
            provider,
            format,
        } => {
            list_rules(filter.as_deref(), provider.as_deref(), &format);
        }
        Commands::Config { action } => {
            handle_config(action)?;
        }
        Commands::Packs { action } => {
            handle_packs(action, &config).await?;
        }
    }

    Ok(())
}

/// Suppression sources shared by every file the CLI visits.
///
/// Bundled so the per-file functions take one parameter instead of two, and so the
/// `SuppressionContext` is built in exactly one place.
struct CliSuppression {
    dictionary: Dictionary,
    morphology: Option<AffixAnalyzer>,
    names: Option<NameFilter>,
}

impl CliSuppression {
    /// Load the workspace dictionary and, if opted in, the name filter.
    ///
    /// The CLI previously ignored the user dictionary entirely, so words the user had
    /// explicitly whitelisted still surfaced as spelling errors here while being
    /// suppressed in the editor. A load failure is non-fatal.
    fn load(workspace_root: &std::path::Path, config: &Config) -> Self {
        let mut dictionary = Dictionary::load(workspace_root).unwrap_or_default();
        if config.dictionaries.bundled {
            dictionary.load_bundled_except(&config.dictionaries.disabled);
        }
        for path in &config.dictionaries.paths {
            if let Err(e) =
                dictionary.load_wordlist_file(std::path::Path::new(path), workspace_root)
            {
                eprintln!("{} {e}", style("warning:").yellow());
            }
        }
        if config.morphology.inflections {
            dictionary.derive_inflections();
        }

        let morphology = config
            .morphology
            .enabled
            .then(|| AffixAnalyzer::new(&config.engines.spell_language));

        let names = config
            .names
            .enabled
            .then(|| NameFilter::new(config.names.aggressiveness, &config.engines.spell_language));

        Self {
            dictionary,
            morphology,
            names,
        }
    }

    const fn context<'a>(&'a self, directives: &'a InlineDirectives) -> SuppressionContext<'a> {
        let mut ctx = SuppressionContext::new()
            .with_dictionary(&self.dictionary)
            .with_directives(directives);
        if let Some(analyzer) = &self.morphology {
            ctx = ctx.with_morphology(analyzer);
        }
        match &self.names {
            Some(filter) => ctx.with_names(filter),
            None => ctx,
        }
    }
}

/// The globs a directory run walks.
///
/// One glob per extension rather than a single `*.{md,markdown}` alternation:
/// the `glob` crate implements `*`, `**` and `[...]` but not brace expansion,
/// so a braced pattern is matched literally and every directory run silently
/// found nothing.
///
/// Without `--lang`, every extension the grammars know. The language used to
/// come from `detect_language` on the *directory*, which has no extension and
/// fell back to Markdown -- so checking a project walked its `.md` files and
/// silently skipped every `.html`, `.tex` and `.typ` in it, reporting a clean
/// result for files it never opened. `--lang` still pins the language each
/// file is *parsed* as; it no longer decides which files exist.
fn directory_patterns(path: &Path, pinned_lang: Option<&str>, config: &Config) -> Vec<String> {
    let root = path.to_string_lossy();
    let Some(lang) = pinned_lang else {
        return lang_check::languages::all_file_patterns(config)
            .into_iter()
            .map(|(suffix, _)| format!("{root}/{suffix}"))
            .collect();
    };
    let exts = lang_check::languages::extensions_for_language(lang, config);
    if exts.is_empty() {
        vec![format!("{root}/**/*.{lang}")]
    } else {
        exts.iter()
            .map(|ext| format!("{root}/**/*.{ext}"))
            .collect()
    }
}

async fn check_path(
    path: PathBuf,
    // The language `--lang` pinned, or None to take each file's own.
    pinned_lang: Option<String>,
    format: &OutputFormat,
    config: Config,
    schema_registry: &SchemaRegistry,
    suppression: &CliSuppression,
) -> Result<()> {
    let mut orchestrator = Orchestrator::new(config.clone());
    let mut all_json_diagnostics: Vec<JsonDiagnostic> = Vec::new();

    // `exclude` is a statement about which files this project checks, so it
    // holds here too. It governed the background indexer alone, which meant
    // `language-check check .` walked straight into `node_modules/**`.
    //
    // Matched against the directory the config was read from, which is where
    // the patterns are written relative to. The file's own parent would make
    // `drafts/**` fail to match `drafts/d.md`, since the path it saw would be
    // just `d.md`.
    let workspace_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // A file's own extension decides its language. For a single file the
    // detection is the same answer `--lang` would give when omitted; for a
    // directory it is the only correct one, because a directory has no
    // extension of its own.
    let language_of = |file: &Path| -> String {
        pinned_lang
            .clone()
            .unwrap_or_else(|| lang_check::languages::detect_language(file, &config))
    };

    if path.is_file() {
        if !config.checks(&path, &workspace_root) {
            if matches!(format, OutputFormat::Pretty) {
                println!("{} is excluded by the config.", path.display());
            }
            return Ok(());
        }
        check_file(
            &path,
            &mut orchestrator,
            &language_of(&path),
            suppression,
            format,
            &mut all_json_diagnostics,
            schema_registry,
        )
        .await?;
    } else {
        let patterns = directory_patterns(&path, pinned_lang.as_deref(), &config);
        let mut files: Vec<PathBuf> = Vec::new();
        for pattern in &patterns {
            files.extend(glob::glob(pattern)?.flatten());
        }
        files.sort_unstable();
        files.dedup();
        files.retain(|file| config.checks(file, &workspace_root));

        let pb = if files.len() > 1 && matches!(format, OutputFormat::Pretty) {
            let bar = ProgressBar::new(files.len() as u64);
            bar.set_style(
                ProgressStyle::default_bar()
                    .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} files ({eta})")
                    .expect("valid template")
                    .progress_chars("#>-"),
            );
            Some(bar)
        } else {
            None
        };

        for p in &files {
            if let Some(ref bar) = pb {
                bar.set_message(
                    p.file_name()
                        .map_or_else(String::new, |n| n.to_string_lossy().to_string()),
                );
            }
            check_file(
                p,
                &mut orchestrator,
                &language_of(p),
                suppression,
                format,
                &mut all_json_diagnostics,
                schema_registry,
            )
            .await?;
            if let Some(ref bar) = pb {
                bar.inc(1);
            }
        }
        if let Some(bar) = pb {
            bar.finish_and_clear();
        }
    }

    if matches!(format, OutputFormat::Json) {
        println!("{}", serde_json::to_string_pretty(&all_json_diagnostics)?);
    }

    Ok(())
}

async fn check_file(
    path: &PathBuf,
    orchestrator: &mut Orchestrator,
    lang: &str,
    suppression: &CliSuppression,
    format: &OutputFormat,
    json_diagnostics: &mut Vec<JsonDiagnostic>,
    schema_registry: &SchemaRegistry,
) -> Result<()> {
    let text = fs::read_to_string(path)?;
    let file_str = path.to_string_lossy();

    if matches!(format, OutputFormat::Pretty) {
        println!("Checking {}...", style(&*file_str).cyan());
    }

    let ranges = prose::extract_with_fallback(
        &text,
        lang,
        Some(path.as_path()),
        Some(schema_registry),
        &prose::latex::LatexExtras::default(),
    )?;
    let mut found_issues = 0;

    let units = prose::range_units(
        &ranges,
        &text,
        &orchestrator.get_config().engines.spell_language,
    );
    let batch = orchestrator
        .check_units_in(&units, &CheckContext::for_path(Some(path.as_path())))
        .await?;
    let directives = InlineDirectives::parse(&text);

    for (range, mut diagnostics) in ranges.iter().zip(batch) {
        range.adopt_diagnostics(&text, &mut diagnostics);
        retain_visible(&mut diagnostics, &text, &suppression.context(&directives));

        for d in diagnostics {
            found_issues += 1;
            let byte_offset = d.start_byte as usize;

            match format {
                OutputFormat::Pretty => {
                    let (line, col) = get_line_col(&text, byte_offset);
                    println!(
                        "  [{line}:{col}] {}: {} ({})",
                        style(&d.unified_id).yellow(),
                        d.message,
                        style(&d.rule_id).dim()
                    );
                    if !d.suggestions.is_empty() {
                        println!(
                            "    Suggestions: {}",
                            style(d.suggestions.join(", ")).green()
                        );
                    }
                }
                OutputFormat::Json => {
                    json_diagnostics.push(JsonDiagnostic::from_diagnostic(
                        &d,
                        &file_str,
                        &text,
                        byte_offset,
                    ));
                }
            }
        }
    }

    if matches!(format, OutputFormat::Pretty) && found_issues == 0 {
        println!("  {}", style("No issues found.").green());
    }

    Ok(())
}

async fn fix_path(
    path: PathBuf,
    lang: String,
    config: Config,
    schema_registry: &SchemaRegistry,
    suppression: &CliSuppression,
) -> Result<()> {
    let mut orchestrator = Orchestrator::new(config);

    if path.is_file() {
        fix_file(
            &path,
            &mut orchestrator,
            &lang,
            schema_registry,
            suppression,
        )
        .await?;
    }

    Ok(())
}

async fn fix_file(
    path: &PathBuf,
    orchestrator: &mut Orchestrator,
    lang: &str,
    schema_registry: &SchemaRegistry,
    suppression: &CliSuppression,
) -> Result<()> {
    let mut text = fs::read_to_string(path)?;
    println!("Fixing {}...", style(path.to_string_lossy()).cyan());

    let ranges = prose::extract_with_fallback(
        &text,
        lang,
        Some(path.as_path()),
        Some(schema_registry),
        &prose::latex::LatexExtras::default(),
    )?;
    let mut total_fixes = 0;

    let mut all_diagnostics = Vec::new();
    let units = prose::range_units(
        &ranges,
        &text,
        &orchestrator.get_config().engines.spell_language,
    );
    let batch = orchestrator
        .check_units_in(&units, &CheckContext::for_path(Some(path.as_path())))
        .await
        .unwrap_or_default();
    let directives = InlineDirectives::parse(&text);
    for (range, mut diagnostics) in ranges.iter().zip(batch) {
        range.adopt_diagnostics(&text, &mut diagnostics);
        retain_visible(&mut diagnostics, &text, &suppression.context(&directives));
        all_diagnostics.extend(diagnostics);
    }

    all_diagnostics.sort_by_key(|d| std::cmp::Reverse(d.start_byte));

    let mut skipped = 0;
    for d in all_diagnostics {
        if d.confidence < 0.8 || d.suggestions.is_empty() {
            continue;
        }

        let start = d.start_byte as usize;
        let end = d.end_byte as usize;

        // Context-aware validation: verify the fix range is still within a prose range
        // (guards against offset drift from prior replacements in this pass)
        let in_prose = ranges
            .iter()
            .any(|r| start >= r.start_byte && end <= r.end_byte);
        if !in_prose {
            skipped += 1;
            continue;
        }

        // Engine-reported offsets are not trusted to sit on a char boundary — `suppression.rs`
        // and `lsp.rs` route the same values through `safe_slice` for exactly this reason. Here
        // the offsets also drive a `replace_range`, which panics on a split char, so a single
        // mid-char offset from any engine would abort the whole `fix` run rather than skip one
        // bad suggestion. Snap first, and skip if snapping moved the span.
        let (lo, hi) = snap_range(&text, start, end);
        if lo != start || hi != end {
            skipped += 1;
            continue;
        }

        // Validate replacement doesn't alter the text in unexpected ways
        // (e.g. replacing across a boundary that now spans multiple words)
        let original = &text[lo..hi];
        let replacement = &d.suggestions[0];
        if original == replacement {
            continue;
        }

        text.replace_range(lo..hi, replacement);
        total_fixes += 1;
    }

    if skipped > 0 {
        println!(
            "  {} {} (low confidence or outside prose)",
            style("Skipped").dim(),
            skipped
        );
    }

    // Apply user-defined auto-fix rules
    let (fixed_text, auto_fix_count) = orchestrator.get_config().apply_auto_fixes(&text);
    if auto_fix_count > 0 {
        text = fixed_text;
        total_fixes += auto_fix_count;
        println!(
            "  Applied {} user-defined auto-fix replacements.",
            style(auto_fix_count).green()
        );
    }

    if total_fixes > 0 {
        fs::write(path, text)?;
        println!("  Applied {} total fixes.", style(total_fixes).green());
    } else {
        println!("  No fixes applied.");
    }

    Ok(())
}

fn list_rules(filter: Option<&str>, provider: Option<&str>, format: &OutputFormat) {
    let normalizer = rules::RuleNormalizer::new();
    let mut mappings = normalizer.all_mappings();

    if let Some(p) = provider {
        mappings.retain(|(prov, _, _)| prov == p);
    }
    if let Some(f) = filter {
        mappings.retain(|(_, _, unified)| unified.starts_with(f));
    }

    match format {
        OutputFormat::Pretty => {
            println!(
                "{:<16} {:<50} {}",
                style("PROVIDER").bold(),
                style("NATIVE RULE ID").bold(),
                style("UNIFIED ID").bold()
            );
            println!("{}", "-".repeat(90));
            for (prov, native, unified) in &mappings {
                println!(
                    "{:<16} {:<50} {}",
                    style(prov).cyan(),
                    native,
                    style(unified).yellow()
                );
            }
            println!("\n{} rules total.", style(mappings.len()).green());
        }
        OutputFormat::Json => {
            let json: Vec<_> = mappings
                .iter()
                .map(
                    |(p, n, u)| serde_json::json!({"provider": p, "native_id": n, "unified_id": u}),
                )
                .collect();
            println!("{}", serde_json::to_string_pretty(&json).unwrap());
        }
    }
}

/// The registry the CLI uses, honouring whatever the config pins.
fn pack_registry(config: &Config) -> PackRegistry {
    let hunspell = &config.engines.hunspell;
    let mut registry = PackRegistry::new();
    for dir in &hunspell.search_paths {
        registry = registry.with_search_path(dir);
    }
    for (language, path) in &hunspell.dictionary_paths {
        registry = registry.with_override(language, path);
    }
    registry
}

/// `language-check packs …`
///
/// Exists so a pack can be installed and checked without an editor in the
/// loop -- for CI, for a headless machine, and for finding out why a language
/// is going unchecked.
async fn handle_packs(action: PackAction, config: &Config) -> Result<()> {
    let registry = pack_registry(config);

    match action {
        PackAction::List => {
            let installed = registry.installed();
            if installed.is_empty() {
                println!("No Hunspell packs found.");
                println!("Searched:");
                for dir in registry.search_paths() {
                    println!("  {}", dir.display());
                }
                return Ok(());
            }
            for pack in installed {
                println!(
                    "{:<10} {:<10} {}",
                    pack.stem,
                    pack.source.to_string(),
                    pack.aff.parent().unwrap_or(&pack.aff).display()
                );
            }
        }
        PackAction::Available => {
            for pack in catalogue::CATALOGUE {
                let state = if registry.resolve(pack.language).is_ok() {
                    "installed"
                } else {
                    "available"
                };
                println!(
                    "{:<6} {:<10} {:<16} {}",
                    pack.language, state, pack.licence, pack.provenance
                );
            }
        }
        PackAction::Install { language, dir } => {
            let Some(pack) = catalogue::find(&language) else {
                anyhow::bail!(
                    "no download is published for \"{language}\"; install a pack yourself and \
                     name it under engines.hunspell.dictionary_paths"
                );
            };
            let target = dir
                .or_else(packs::managed_dir)
                .ok_or_else(|| anyhow::anyhow!("could not determine the user data directory"))?;

            // Said before anything is fetched: these are someone else's terms
            // on someone else's work.
            println!("{} — {}, {}", pack.stem, pack.licence, pack.provenance);
            println!("Installing into {}", target.display());

            let report = packs::install::install(pack, &target)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("Installed {} entries.", report.entries);
            for warning in &report.warnings {
                eprintln!("{} {warning}", style("warning:").yellow());
            }
        }
        PackAction::Verify { language } => {
            let pack = registry
                .resolve(&language)
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("{} ({}) at {}", pack.stem, pack.source, pack.aff.display());
            let report = packs::validate(&pack).map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("{} entries, readable and parseable.", report.entries);
            for warning in &report.warnings {
                eprintln!("{} {warning}", style("warning:").yellow());
            }
        }
    }
    Ok(())
}

fn handle_config(action: ConfigAction) -> Result<()> {
    match action {
        ConfigAction::Show => {
            let config = Config::load(&std::env::current_dir()?).unwrap_or_else(|e| {
                eprintln!(
                    "lang-check: ignoring unreadable .languagecheck.yaml, using defaults: {e}"
                );
                Config::default()
            });
            println!("{}", serde_yaml::to_string(&config)?);
        }
        ConfigAction::Files {
            skipped,
            bare,
            path,
        } => {
            list_selected_files(&path, skipped, bare)?;
        }
        ConfigAction::Init => {
            let yaml_path = std::env::current_dir()?.join(".languagecheck.yaml");
            let json_path = std::env::current_dir()?.join(".languagecheck.json");
            if yaml_path.exists() || json_path.exists() {
                let existing = if yaml_path.exists() {
                    ".languagecheck.yaml"
                } else {
                    ".languagecheck.json"
                };
                println!(
                    "{} {} already exists.",
                    style("Warning:").yellow(),
                    existing
                );
                return Ok(());
            }
            let config = Config::default();
            fs::write(&yaml_path, serde_yaml::to_string(&config)?)?;
            println!(
                "Created {} with default configuration.",
                style(".languagecheck.yaml").green()
            );
        }
    }
    Ok(())
}

/// Show which files the config selects, and which pattern rejected the rest.
///
/// `include` and `exclude` decide what this project checks, and until you can
/// see the answer the only way to find out is to run a check and count. A
/// pattern that silently matches nothing, or one that swallows a directory
/// nobody meant to drop, both look exactly like a checker that is working.
/// What a config selects, and what it turned away.
struct Selection {
    selected: Vec<PathBuf>,
    /// Each rejected path with the list that rejected it.
    rejected: Vec<(PathBuf, &'static str)>,
}

/// Walk the same patterns the indexer walks and sort the results by verdict.
///
/// The grammars decide which extensions are candidates, so this answers for
/// what the editor and CI will visit and not for every file on disk.
fn select_files(
    config: &Config,
    root: &Path,
    search_from: &Path,
    with_rejected: bool,
) -> Selection {
    let mut patterns = lang_check::languages::all_file_patterns(config);
    patterns.sort();
    patterns.dedup();

    let mut selection = Selection {
        selected: Vec::new(),
        rejected: Vec::new(),
    };
    for (suffix, _lang) in &patterns {
        let Ok(entries) = glob(&format!("{}/{}", search_from.to_string_lossy(), suffix)) else {
            continue;
        };
        for found in entries.flatten() {
            if config.checks(&found, root) {
                selection.selected.push(found);
            } else if with_rejected {
                let list = if !config.admits_type(&found) {
                    "file_types"
                } else if config.includes(&found, root) {
                    "exclude"
                } else {
                    "include"
                };
                selection.rejected.push((found, list));
            }
        }
    }
    selection.selected.sort();
    selection.selected.dedup();
    selection.rejected.sort();
    selection.rejected.dedup();
    selection
}

/// Show which files the config selects, and which list rejected the rest.
///
/// `include` and `exclude` decide what this project checks, and until you can
/// see the answer the only way to find out is to run a check and count. A
/// pattern that matches nothing, and one that swallows a directory nobody
/// meant to drop, both look exactly like a checker that is working.
fn list_selected_files(target: &Path, show_skipped: bool, bare: bool) -> Result<()> {
    let root = std::env::current_dir()?;
    let config = Config::load(&root).unwrap_or_else(|e| {
        eprintln!("lang-check: ignoring unreadable .languagecheck.yaml, using defaults: {e}");
        Config::default()
    });

    let search_from = if target == Path::new(".") {
        root.clone()
    } else {
        root.join(target)
    };
    let selection = select_files(&config, &root, &search_from, show_skipped);

    let relative = |p: &Path| -> String {
        p.strip_prefix(&root)
            .unwrap_or(p)
            .to_string_lossy()
            .into_owned()
    };

    if bare {
        for file in &selection.selected {
            println!("{}", relative(file));
        }
        return Ok(());
    }

    if config.include.is_empty() {
        println!(
            "{} every file the grammars recognise",
            style("include:").bold()
        );
    } else {
        println!("{} {}", style("include:").bold(), config.include.join(", "));
    }
    if !config.file_types.is_empty() {
        println!(
            "{} {}",
            style("file_types:").bold(),
            config.file_types.join(", ")
        );
    }
    println!(
        "{} {} pattern(s)\n",
        style("exclude:").bold(),
        config.exclude.len()
    );

    for file in &selection.selected {
        println!("  {} {}", style("+").green(), relative(file));
    }
    for (file, list) in &selection.rejected {
        println!(
            "  {} {} {}",
            style("-").red(),
            relative(file),
            style(format!("({list})")).dim()
        );
    }
    println!(
        "\n{} file(s) selected{}",
        style(selection.selected.len()).bold(),
        if show_skipped {
            format!(", {} skipped", selection.rejected.len())
        } else {
            String::new()
        }
    );
    Ok(())
}

fn get_line_col(text: &str, byte_offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut col = 1;
    for (i, c) in text.char_indices() {
        if i == byte_offset {
            break;
        }
        if c == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    (line, col)
}
