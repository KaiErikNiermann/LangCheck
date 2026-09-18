//! Dump a tree-sitter parse tree plus the extracted prose for one file.
//!
//! Debug aid: `cargo run --example ast-dump -- <lang-id> <file>`.
use std::env;
use std::fs;

use anyhow::{Result, anyhow};
use lang_check::prose::{ProseExtractor, latex::LatexExtras};

fn dump(node: tree_sitter::Node, src: &str, depth: usize) {
    let text = &src[node.start_byte()..node.end_byte()];
    let snippet: String = text.chars().take(40).collect();
    println!(
        "{:indent$}{} [{}..{}] {:?}",
        "",
        node.kind(),
        node.start_byte(),
        node.end_byte(),
        snippet,
        indent = depth * 2
    );
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        dump(child, src, depth + 1);
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let lang_id = args
        .get(1)
        .ok_or_else(|| anyhow!("usage: ast-dump <lang> <file>"))?;
    let path = args
        .get(2)
        .ok_or_else(|| anyhow!("usage: ast-dump <lang> <file>"))?;
    let src = fs::read_to_string(path)?;

    let language = lang_check::languages::resolve_ts_language(lang_id);
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&language)?;
    let tree = parser
        .parse(&src, None)
        .ok_or_else(|| anyhow!("parse failed"))?;
    dump(tree.root_node(), &src, 0);

    println!("\n--- prose ---");
    let mut extractor = ProseExtractor::new(language)?;
    for range in extractor.extract(&src, lang_id, &LatexExtras::default())? {
        println!(
            "[{}..{}] exclusions={:?} {:?}",
            range.start_byte,
            range.end_byte,
            range.exclusions,
            range.extract_text(&src)
        );
    }
    Ok(())
}
