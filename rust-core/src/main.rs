pub mod checker {
    include!(concat!(env!("OUT_DIR"), "/languagecheck.rs"));
}

pub mod prose;

use anyhow::Result;
use prose::ProseExtractor;

fn main() -> Result<()> {
    // In Markdown, there are actually two "languages": 
    // the block-level structure and the inline-level structure.
    // For now, let's just use the basic one.
    let language = tree_sitter_markdown::language();
    let mut extractor = ProseExtractor::new(language)?;
    
    let text = "# Hello\nThis is a paragraph.";
    let ranges = extractor.extract(text)?;
    
    for range in ranges {
        println!("Prose range: {}..{}", range.start_byte, range.end_byte);
    }
    
    Ok(())
}
