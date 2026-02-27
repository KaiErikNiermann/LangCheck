use anyhow::Result;
use clap::{Parser, Subcommand};
use console::style;
use rust_core::{prose, engines, orchestrator};
use prose::ProseExtractor;
use engines::{HarperEngine, LanguageToolEngine};
use orchestrator::Orchestrator;
use std::path::PathBuf;
use std::fs;

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
        /// Language ID (default: markdown)
        #[arg(short, long, default_value = "markdown")]
        lang: String,
    },
    /// Fix a file by applying high-confidence suggestions
    Fix {
        /// Path to file
        path: PathBuf,
        /// Language ID
        #[arg(short, long, default_value = "markdown")]
        lang: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Check { path, lang } => {
            check_path(path, lang).await?;
        }
        Commands::Fix { path, lang } => {
            fix_path(path, lang).await?;
        }
    }

    Ok(())
}

async fn check_path(path: PathBuf, lang: String) -> Result<()> {
    let mut orchestrator = Orchestrator::new();
    orchestrator.add_engine(Box::new(HarperEngine::new()));
    orchestrator.add_engine(Box::new(LanguageToolEngine::new("http://localhost:8010".to_string())));

    let language = match lang.as_str() {
        "markdown" => tree_sitter_markdown::language(),
        "html" => tree_sitter_html::language(),
        _ => tree_sitter_markdown::language(),
    };
    let mut extractor = ProseExtractor::new(language)?;

    if path.is_file() {
        check_file(&path, &mut extractor, &mut orchestrator, &lang).await?;
    } else {
        let pattern = match lang.as_str() {
            "html" => "**/*.html",
            _ => "**/*.md",
        };
        let entries = glob::glob(&format!("{}/{}", path.to_string_lossy(), pattern))?;
        for entry in entries {
            if let Ok(p) = entry {
                check_file(&p, &mut extractor, &mut orchestrator, &lang).await?;
            }
        }
    }

    Ok(())
}

async fn check_file(path: &PathBuf, extractor: &mut ProseExtractor, orchestrator: &mut Orchestrator, lang: &str) -> Result<()> {
    let text = fs::read_to_string(path)?;
    println!("Checking {}...", style(path.to_string_lossy()).cyan());

    let ranges = extractor.extract(&text, lang)?;
    let mut found_issues = 0;

    for range in ranges {
        let prose_text = &text[range.start_byte..range.end_byte];
        let diagnostics = orchestrator.check(prose_text, lang).await?;
        
        for d in diagnostics {
            found_issues += 1;
            let line_col = get_line_col(&text, range.start_byte + d.start_byte as usize);
            println!(
                "  [{}:{}] {}: {} ({})",
                line_col.0, line_col.1,
                style(&d.unified_id).yellow(),
                d.message,
                style(&d.rule_id).dim()
            );
            if !d.suggestions.is_empty() {
                println!("    Suggestions: {}", style(d.suggestions.join(", ")).green());
            }
        }
    }

    if found_issues == 0 {
        println!("  {}", style("No issues found.").green());
    }

    Ok(())
}

async fn fix_path(path: PathBuf, lang: String) -> Result<()> {
    let mut orchestrator = Orchestrator::new();
    orchestrator.add_engine(Box::new(HarperEngine::new()));
    
    let language = match lang.as_str() {
        "markdown" => tree_sitter_markdown::language(),
        "html" => tree_sitter_html::language(),
        _ => tree_sitter_markdown::language(),
    };
    let mut extractor = ProseExtractor::new(language)?;

    if path.is_file() {
        fix_file(&path, &mut extractor, &mut orchestrator, &lang).await?;
    }
    
    Ok(())
}

async fn fix_file(path: &PathBuf, extractor: &mut ProseExtractor, orchestrator: &mut Orchestrator, lang: &str) -> Result<()> {
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
