//! Shared prose extraction utilities used by language-specific extractors.
//!
//! The merge/bridge logic is identical across forester, tinylang, and latex
//! extractors. This module provides the common implementation, parameterized
//! by language-specific noise stripping and exclusion collection callbacks.

use super::ProseRange;

/// Characters that are allowed in a bridgeable gap (after noise stripping).
fn is_bridge_char(c: char) -> bool {
    c.is_ascii_whitespace()
        || matches!(
            c,
            ',' | '.'
                | ';'
                | ':'
                | '!'
                | '?'
                | '('
                | ')'
                | '\''
                | '"'
                | '-'
                | '\u{2013}'
                | '\u{2014}'
                | '['
                | ']'
                | '{'
                | '}'
                | '~'
        )
}

/// Merge adjacent word ranges into prose chunks with gap analysis.
///
/// - `words`: byte ranges of text/leaf nodes collected by the language extractor
/// - `text`: the full source text
/// - `strip_noise`: language-specific function to remove markup noise from gap strings
/// - `collect_exclusions`: language-specific function to find math/code regions in gaps
///   that should be excluded from checking (called with the gap string and its byte offset)
pub fn merge_ranges(
    words: &[(usize, usize)],
    text: &str,
    strip_noise: fn(&str) -> String,
    collect_exclusions: fn(&str, usize, &mut Vec<(usize, usize)>),
) -> Vec<ProseRange> {
    if words.is_empty() {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut chunk_start = words[0].0;
    let mut chunk_end = words[0].1;
    let mut exclusions: Vec<(usize, usize)> = Vec::new();

    for &(start, end) in &words[1..] {
        let gap = &text[chunk_end..start];

        if !is_bridgeable_gap(gap, strip_noise) {
            ranges.push(ProseRange {
                start_byte: chunk_start,
                end_byte: chunk_end,
                exclusions: std::mem::take(&mut exclusions),
            });
            chunk_start = start;
        } else {
            collect_exclusions(gap, chunk_end, &mut exclusions);
        }
        chunk_end = end;
    }

    ranges.push(ProseRange {
        start_byte: chunk_start,
        end_byte: chunk_end,
        exclusions,
    });

    ranges
}

/// Check if a gap between two text ranges can be bridged into one prose chunk.
///
/// Returns `false` for paragraph breaks (`\n\n`). After stripping language-specific
/// noise, the remaining characters must all be whitespace or punctuation.
fn is_bridgeable_gap(gap: &str, strip_noise: fn(&str) -> String) -> bool {
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    let stripped = strip_noise(gap);

    // After stripping language-specific noise, a paragraph break may be
    // revealed (e.g. a comment on its own line: \n// comment\n → \n\n).
    if stripped.contains("\n\n") || stripped.contains("\r\n\r\n") {
        return false;
    }

    stripped.chars().all(is_bridge_char)
}
