//! How many prose chunks survive a one-word edit?
//!
//! A chunk is a cache key, so a chunk whose text is unchanged is a cache hit.
//! If a split point is chosen by distance from the range start, inserting text
//! moves every later boundary and nothing hits.

use lang_check::prose::{self, latex::LatexExtras};
use std::collections::HashSet;

fn chunks(text: &str, lang: &str) -> Vec<String> {
    let ranges = prose::extract_with_fallback(text, lang, None, None, &LatexExtras::default())
        .expect("extraction");
    prose::range_texts(&ranges, text)
}

fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .expect("usage: chunk_stability <file> [lang]");
    let lang = std::env::args().nth(2).unwrap_or_else(|| "markdown".into());
    let base = std::fs::read_to_string(&path)?;
    let at = base[..base.len() / 3].rfind(". ").map_or(0, |i| i + 2);

    let before = chunks(&base, &lang);
    let mut edited = base.clone();
    edited.insert_str(at, "inserted ");
    let after = chunks(&edited, &lang);

    let kept: HashSet<&String> = before.iter().collect::<HashSet<_>>();
    let hits = after.iter().filter(|c| kept.contains(c)).count();
    println!("chunks before {}, after {}", before.len(), after.len());
    println!(
        "unchanged after a one-word edit: {hits}/{} ({:.0}% cache hits)",
        after.len(),
        100.0 * hits as f64 / after.len() as f64
    );
    Ok(())
}
