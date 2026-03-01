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
use indicatif::{ProgressBar, ProgressStyle};
use orchestrator::Orchestrator;
use rust_core::sls::SchemaRegistry;
use rust_core::{checker::Diagnostic, config, orchestrator, prose, rules};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "language-check")]
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
}

#[derive(Copy, Clone, Subcommand)]
enum ConfigAction {
    /// Show the current effective configuration
    Show,
    /// Generate a default .languagecheck.json in the current directory
    Init,
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
        let severity = match d.severity {
            1 => "error",
            2 => "warning",
            3 => "information",
            4 => "hint",
            _ => "unknown",
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
    let config = Config::load(&current_dir).unwrap_or_else(|_| Config::default());

    match cli.command {
        Commands::Check { path, lang, format } => {
            let schema_registry = SchemaRegistry::from_workspace(&current_dir)?;
            let lang = lang.map_or_else(
                || rust_core::languages::detect_language(&path, &config),
                |l| rust_core::languages::resolve_language_id(&l).to_string(),
            );
            check_path(path, lang, &format, config, &schema_registry).await?;
        }
        Commands::Fix { path, lang } => {
            let schema_registry = SchemaRegistry::from_workspace(&current_dir)?;
            let lang = lang.map_or_else(
                || rust_core::languages::detect_language(&path, &config),
                |l| rust_core::languages::resolve_language_id(&l).to_string(),
            );
            fix_path(path, lang, config, &schema_registry).await?;
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
    }

    Ok(())
}

async fn check_path(
    path: PathBuf,
    lang: String,
    format: &OutputFormat,
    config: Config,
    schema_registry: &SchemaRegistry,
) -> Result<()> {
    let mut orchestrator = Orchestrator::new(config.clone());
    let mut all_json_diagnostics: Vec<JsonDiagnostic> = Vec::new();

    if path.is_file() {
        check_file(
            &path,
            &mut orchestrator,
            &lang,
            format,
            &mut all_json_diagnostics,
            schema_registry,
        )
        .await?;
    } else {
        let exts = rust_core::languages::extensions_for_language(&lang, &config);
        let pattern = if exts.is_empty() {
            format!("**/*.{lang}")
        } else {
            format!("**/*.{{{}}}", exts.join(","))
        };
        let files: Vec<_> = glob::glob(&format!("{}/{}", path.to_string_lossy(), pattern))?
            .flatten()
            .collect();

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
                &lang,
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
    format: &OutputFormat,
    json_diagnostics: &mut Vec<JsonDiagnostic>,
    schema_registry: &SchemaRegistry,
) -> Result<()> {
    let text = fs::read_to_string(path)?;
    let file_str = path.to_string_lossy();

    if matches!(format, OutputFormat::Pretty) {
        println!("Checking {}...", style(&*file_str).cyan());
    }

    let ranges =
        prose::extract_with_fallback(&text, lang, Some(path.as_path()), Some(schema_registry), &prose::latex::LatexExtras::default())?;
    let mut found_issues = 0;

    for range in ranges {
        let prose_text = range.extract_text(&text);
        let mut diagnostics = orchestrator.check(&prose_text, lang).await?;
        diagnostics.retain(|d| !range.overlaps_exclusion(d.start_byte, d.end_byte));

        for d in diagnostics {
            found_issues += 1;
            let byte_offset = range.start_byte + d.start_byte as usize;

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
) -> Result<()> {
    let mut orchestrator = Orchestrator::new(config);

    if path.is_file() {
        fix_file(&path, &mut orchestrator, &lang, schema_registry).await?;
    }

    Ok(())
}

async fn fix_file(
    path: &PathBuf,
    orchestrator: &mut Orchestrator,
    lang: &str,
    schema_registry: &SchemaRegistry,
) -> Result<()> {
    let mut text = fs::read_to_string(path)?;
    println!("Fixing {}...", style(path.to_string_lossy()).cyan());

    let ranges =
        prose::extract_with_fallback(&text, lang, Some(path.as_path()), Some(schema_registry), &prose::latex::LatexExtras::default())?;
    let mut total_fixes = 0;

    let mut all_diagnostics = Vec::new();
    for range in &ranges {
        let prose_text = range.extract_text(&text);
        if let Ok(mut diagnostics) = orchestrator.check(&prose_text, lang).await {
            diagnostics.retain(|d| !range.overlaps_exclusion(d.start_byte, d.end_byte));
            for d in &mut diagnostics {
                d.start_byte += range.start_byte as u32;
                d.end_byte += range.start_byte as u32;
            }
            all_diagnostics.extend(diagnostics);
        }
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

        // Validate replacement doesn't alter the text in unexpected ways
        // (e.g. replacing across a boundary that now spans multiple words)
        let original = &text[start..end.min(text.len())];
        let replacement = &d.suggestions[0];
        if original == replacement {
            continue;
        }

        text.replace_range(start..end, replacement);
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

fn handle_config(action: ConfigAction) -> Result<()> {
    match action {
        ConfigAction::Show => {
            let config =
                Config::load(&std::env::current_dir()?).unwrap_or_else(|_| Config::default());
            println!("{}", serde_yaml::to_string(&config)?);
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
