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
use orchestrator::Orchestrator;
use prose::ProseExtractor;
use rust_core::{checker::Diagnostic, config, orchestrator, prose};
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

    match cli.command {
        Commands::Check { path, lang, format } => {
            let lang = lang.unwrap_or_else(|| detect_lang(&path));
            check_path(path, lang, &format).await?;
        }
        Commands::Fix { path, lang } => {
            let lang = lang.unwrap_or_else(|| detect_lang(&path));
            fix_path(path, lang).await?;
        }
    }

    Ok(())
}

async fn check_path(path: PathBuf, lang: String, format: &OutputFormat) -> Result<()> {
    let config = Config::load(&std::env::current_dir()?).unwrap_or_else(|_| Config::default());
    let mut orchestrator = Orchestrator::new(config);

    let language = match lang.as_str() {
        "html" => tree_sitter_html::language(),
        "latex" => latex_language(),
        _ => tree_sitter_markdown::language(),
    };
    let mut extractor = ProseExtractor::new(language)?;
    let mut all_json_diagnostics: Vec<JsonDiagnostic> = Vec::new();

    if path.is_file() {
        check_file(&path, &mut extractor, &mut orchestrator, &lang, format, &mut all_json_diagnostics).await?;
    } else {
        let pattern = match lang.as_str() {
            "html" => "**/*.html",
            "latex" => "**/*.tex",
            _ => "**/*.md",
        };
        let entries = glob::glob(&format!("{}/{}", path.to_string_lossy(), pattern))?;
        for p in entries.flatten() {
            check_file(&p, &mut extractor, &mut orchestrator, &lang, format, &mut all_json_diagnostics).await?;
        }
    }

    if matches!(format, OutputFormat::Json) {
        println!("{}", serde_json::to_string_pretty(&all_json_diagnostics)?);
    }

    Ok(())
}

async fn check_file(
    path: &PathBuf,
    extractor: &mut ProseExtractor,
    orchestrator: &mut Orchestrator,
    lang: &str,
    format: &OutputFormat,
    json_diagnostics: &mut Vec<JsonDiagnostic>,
) -> Result<()> {
    let text = fs::read_to_string(path)?;
    let file_str = path.to_string_lossy();

    if matches!(format, OutputFormat::Pretty) {
        println!("Checking {}...", style(&*file_str).cyan());
    }

    let ranges = extractor.extract(&text, lang)?;
    let mut found_issues = 0;

    for range in ranges {
        let prose_text = &text[range.start_byte..range.end_byte];
        let diagnostics = orchestrator.check(prose_text, lang).await?;

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
                        &d, &file_str, &text, byte_offset,
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

async fn fix_path(path: PathBuf, lang: String) -> Result<()> {
    let config = Config::load(&std::env::current_dir()?).unwrap_or_else(|_| Config::default());
    let mut orchestrator = Orchestrator::new(config);

    let language = match lang.as_str() {
        "html" => tree_sitter_html::language(),
        "latex" => latex_language(),
        _ => tree_sitter_markdown::language(),
    };
    let mut extractor = ProseExtractor::new(language)?;

    if path.is_file() {
        fix_file(&path, &mut extractor, &mut orchestrator, &lang).await?;
    }

    Ok(())
}

async fn fix_file(
    path: &PathBuf,
    extractor: &mut ProseExtractor,
    orchestrator: &mut Orchestrator,
    lang: &str,
) -> Result<()> {
    let mut text = fs::read_to_string(path)?;
    println!("Fixing {}...", style(path.to_string_lossy()).cyan());

    let ranges = extractor.extract(&text, lang)?;
    let mut total_fixes = 0;

    let mut all_diagnostics = Vec::new();
    for range in &ranges {
        let prose_text = &text[range.start_byte..range.end_byte];
        if let Ok(mut diagnostics) = orchestrator.check(prose_text, lang).await {
            for d in &mut diagnostics {
                d.start_byte += range.start_byte as u32;
                d.end_byte += range.start_byte as u32;
            }
            all_diagnostics.extend(diagnostics);
        }
    }

    all_diagnostics.sort_by_key(|d| std::cmp::Reverse(d.start_byte));

    for d in all_diagnostics {
        if d.confidence >= 0.8 && !d.suggestions.is_empty() {
            let replacement = &d.suggestions[0];
            text.replace_range(d.start_byte as usize..d.end_byte as usize, replacement);
            total_fixes += 1;
        }
    }

    if total_fixes > 0 {
        fs::write(path, text)?;
        println!("  Applied {} fixes.", style(total_fixes).green());
    } else {
        println!("  No fixes applied.");
    }

    Ok(())
}

fn detect_lang(path: &std::path::Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html" | "htm") => "html".to_string(),
        Some("tex" | "latex") => "latex".to_string(),
        _ => "markdown".to_string(),
    }
}

fn latex_language() -> tree_sitter::Language {
    let raw_fn = codebook_tree_sitter_latex::LANGUAGE.into_raw();
    unsafe { std::mem::transmute(raw_fn()) }
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
