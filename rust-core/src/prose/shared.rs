//! Shared prose extraction utilities used by language-specific extractors.
//!
//! The merge/bridge logic is identical across forester, tinylang, and latex
//! extractors. This module provides the common implementation, parameterized
//! by language-specific noise stripping and exclusion collection callbacks.

use super::ProseRange;

/// Characters that are allowed in a bridgeable gap (after noise stripping).
const fn is_bridge_char(c: char) -> bool {
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

        if is_bridgeable_gap(gap, strip_noise) {
            collect_exclusions(gap, chunk_end, &mut exclusions);
        } else {
            ranges.push(ProseRange {
                start_byte: chunk_start,
                end_byte: chunk_end,
                exclusions: std::mem::take(&mut exclusions),
            });
            chunk_start = start;
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

// ---------------------------------------------------------------------------
// Balanced-delimiter utilities
// ---------------------------------------------------------------------------

/// Skip balanced delimiters on bytes. `i` is just past the opening delimiter.
/// Returns position just past the closing delimiter.
/// `escape`: optional escape byte (e.g. `Some(b'\\')`) — when encountered,
/// the next byte is unconditionally consumed.
pub fn skip_balanced_bytes(
    bytes: &[u8],
    mut i: usize,
    open: u8,
    close: u8,
    escape: Option<u8>,
) -> usize {
    let mut depth: u32 = 1;
    while i < bytes.len() && depth > 0 {
        if let Some(esc) = escape
            && bytes[i] == esc
            && i + 1 < bytes.len()
        {
            i += 2;
            continue;
        }
        if bytes[i] == open {
            depth += 1;
        } else if bytes[i] == close {
            depth -= 1;
        }
        i += 1;
    }
    i
}

/// Skip balanced delimiters on chars. `i` is just past the opening delimiter.
/// Returns position just past the closing delimiter.
pub fn skip_balanced_chars(chars: &[char], mut i: usize, open: char, close: char) -> usize {
    let mut depth: u32 = 1;
    while i < chars.len() && depth > 0 {
        if chars[i] == open {
            depth += 1;
        } else if chars[i] == close {
            depth -= 1;
        }
        i += 1;
    }
    i
}

/// Skip consecutive bracketed argument groups on bytes.
/// e.g. `{arg1}[opt]{arg2}` with `pairs = &[(b'{', b'}'), (b'[', b']')]`.
/// `i` is the position of the first potential opening delimiter.
/// Returns position just past the last closing delimiter consumed.
pub fn skip_command_args_bytes(bytes: &[u8], mut i: usize, pairs: &[(u8, u8)]) -> usize {
    while i < bytes.len() {
        if let Some(&(open, close)) = pairs.iter().find(|(o, _)| *o == bytes[i]) {
            i = skip_balanced_bytes(bytes, i + 1, open, close, None);
        } else {
            break;
        }
    }
    i
}

/// Skip consecutive bracketed argument groups on chars.
/// `i` is the position of the first potential opening delimiter.
/// Returns position just past the last closing delimiter consumed.
pub fn skip_command_args_chars(chars: &[char], mut i: usize, pairs: &[(char, char)]) -> usize {
    while i < chars.len() {
        if let Some(&(open, close)) = pairs.iter().find(|(o, _)| *o == chars[i]) {
            i = skip_balanced_chars(chars, i + 1, open, close);
        } else {
            break;
        }
    }
    i
}

// ---------------------------------------------------------------------------
// Exclusion management utilities
// ---------------------------------------------------------------------------

/// Install skip-node byte ranges as exclusions on merged prose ranges.
///
/// For each `ProseRange`, finds all skip ranges that overlap `[start_byte, end_byte)`,
/// extends each to cover surrounding whitespace (so the checker sees clean boundaries),
/// and adds them as exclusions.
pub fn install_skip_exclusions(ranges: &mut [ProseRange], skips: &[(usize, usize)], text: &[u8]) {
    for range in ranges.iter_mut() {
        for &(skip_start, skip_end) in skips {
            if skip_end <= range.start_byte || skip_start >= range.end_byte {
                continue;
            }
            let mut exc_start = skip_start.max(range.start_byte);
            let mut exc_end = skip_end.min(range.end_byte);
            while exc_start > range.start_byte && text[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }
            while exc_end < range.end_byte && text[exc_end].is_ascii_whitespace() {
                exc_end += 1;
            }
            range.exclusions.push((exc_start, exc_end));
        }
    }
}

/// Merge overlapping or adjacent exclusions within each prose range.
pub fn dedup_exclusions(ranges: &mut [ProseRange]) {
    for range in ranges.iter_mut() {
        if range.exclusions.len() <= 1 {
            continue;
        }
        range.exclusions.sort_unstable_by_key(|&(s, _)| s);
        let mut merged = vec![range.exclusions[0]];
        for &(s, e) in &range.exclusions[1..] {
            let last = merged.last_mut().unwrap();
            if s <= last.1 {
                last.1 = last.1.max(e);
            } else {
                merged.push((s, e));
            }
        }
        range.exclusions = merged;
    }
}

/// Check whether a prose range is entirely covered by its exclusions.
pub fn is_fully_excluded(range: &ProseRange) -> bool {
    if range.exclusions.is_empty() {
        return false;
    }
    let mut covered = range.start_byte;
    for &(s, e) in &range.exclusions {
        if s > covered {
            return false;
        }
        covered = covered.max(e);
    }
    covered >= range.end_byte
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skip_balanced_bytes_simple() {
        let b = b"{hello}";
        // i=1 is just past the opening '{'
        assert_eq!(skip_balanced_bytes(b, 1, b'{', b'}', None), 7);
    }

    #[test]
    fn test_skip_balanced_bytes_nested() {
        let b = b"{a{b{c}d}e}rest";
        assert_eq!(skip_balanced_bytes(b, 1, b'{', b'}', None), 11);
    }

    #[test]
    fn test_skip_balanced_bytes_with_escape() {
        // \} should not close; the real closing } is at the end
        let b = br"{\}}";
        assert_eq!(skip_balanced_bytes(b, 1, b'{', b'}', Some(b'\\')), 4);
    }

    #[test]
    fn test_skip_balanced_bytes_unterminated() {
        let b = b"{abc";
        assert_eq!(skip_balanced_bytes(b, 1, b'{', b'}', None), 4);
    }

    #[test]
    fn test_skip_balanced_chars_simple() {
        let chars: Vec<char> = "{hello}".chars().collect();
        assert_eq!(skip_balanced_chars(&chars, 1, '{', '}'), 7);
    }

    #[test]
    fn test_skip_balanced_chars_nested() {
        let chars: Vec<char> = "{a{b}c}rest".chars().collect();
        assert_eq!(skip_balanced_chars(&chars, 1, '{', '}'), 7);
    }

    #[test]
    fn test_skip_command_args_bytes_multi() {
        let b = b"{arg1}[opt]{arg2}rest";
        let end = skip_command_args_bytes(b, 0, &[(b'{', b'}'), (b'[', b']')]);
        assert_eq!(end, 17);
    }

    #[test]
    fn test_skip_command_args_bytes_no_args() {
        let b = b"rest";
        assert_eq!(skip_command_args_bytes(b, 0, &[(b'{', b'}')]), 0);
    }

    #[test]
    fn test_skip_command_args_chars_multi() {
        let chars: Vec<char> = "{x}[y]{z}tail".chars().collect();
        let end = skip_command_args_chars(&chars, 0, &[('{', '}'), ('[', ']')]);
        assert_eq!(end, 9);
    }

    #[test]
    fn test_dedup_exclusions_merges_overlapping() {
        let mut ranges = vec![ProseRange {
            start_byte: 0,
            end_byte: 100,
            exclusions: vec![(10, 30), (10, 25), (20, 40), (50, 60)],
        }];
        dedup_exclusions(&mut ranges);
        assert_eq!(ranges[0].exclusions, vec![(10, 40), (50, 60)]);
    }

    #[test]
    fn test_dedup_exclusions_adjacent() {
        let mut ranges = vec![ProseRange {
            start_byte: 0,
            end_byte: 100,
            exclusions: vec![(10, 20), (20, 30)],
        }];
        dedup_exclusions(&mut ranges);
        assert_eq!(ranges[0].exclusions, vec![(10, 30)]);
    }

    #[test]
    fn test_is_fully_excluded_covered() {
        let r = ProseRange {
            start_byte: 10,
            end_byte: 50,
            exclusions: vec![(10, 50)],
        };
        assert!(is_fully_excluded(&r));
    }

    #[test]
    fn test_is_fully_excluded_gap() {
        let r = ProseRange {
            start_byte: 10,
            end_byte: 50,
            exclusions: vec![(10, 30), (35, 50)],
        };
        assert!(!is_fully_excluded(&r));
    }

    #[test]
    fn test_is_fully_excluded_empty() {
        let r = ProseRange {
            start_byte: 10,
            end_byte: 50,
            exclusions: vec![],
        };
        assert!(!is_fully_excluded(&r));
    }
}
