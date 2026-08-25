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
pub const fn skip_balanced_bytes(
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
pub const fn skip_balanced_chars(chars: &[char], mut i: usize, open: char, close: char) -> usize {
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
/// For each `ProseRange`, finds all skip ranges that overlap `[start_byte, end_byte)`
/// and adds them as exclusions. A flanking whitespace run is folded into the
/// exclusion only when it contains a line break, so a hard newline around
/// block/display math is flattened to spaces (otherwise the checker sees the
/// next line as a new, uncapitalized sentence). Ordinary inline spacing is left
/// outside the exclusion, keeping its bounds tight against the skipped content.
pub fn install_skip_exclusions(ranges: &mut [ProseRange], skips: &[(usize, usize)], text: &[u8]) {
    for range in ranges.iter_mut() {
        for &(skip_start, skip_end) in skips {
            if skip_end <= range.start_byte || skip_start >= range.end_byte {
                continue;
            }
            let exc_start = skip_start.max(range.start_byte);
            let exc_end = skip_end.min(range.end_byte);
            range.exclusions.push((
                absorb_linebreak_left(text, range.start_byte, exc_start),
                absorb_linebreak_right(text, range.end_byte, exc_end),
            ));
        }
    }
}

/// Extend `from` leftward over a whitespace run iff that run contains a line
/// break; returns the (possibly unchanged) new start.
fn absorb_linebreak_left(text: &[u8], lower_bound: usize, from: usize) -> usize {
    let mut s = from;
    while s > lower_bound && text[s - 1].is_ascii_whitespace() {
        s -= 1;
    }
    if text[s..from].iter().any(|&b| b == b'\n' || b == b'\r') {
        s
    } else {
        from
    }
}

/// Extend `from` rightward over a whitespace run iff that run contains a line
/// break; returns the (possibly unchanged) new end.
fn absorb_linebreak_right(text: &[u8], upper_bound: usize, from: usize) -> usize {
    let mut e = from;
    while e < upper_bound && text[e].is_ascii_whitespace() {
        e += 1;
    }
    if text[from..e].iter().any(|&b| b == b'\n' || b == b'\r') {
        e
    } else {
        from
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

// ---------------------------------------------------------------------------
// Cross-block continuation merging
// ---------------------------------------------------------------------------

/// Merge adjacent prose blocks that are a logical continuation of one another,
/// so a sentence split across markup boundaries (e.g. `\p{Here is something}
/// ##{math} \p{continuation.}`) is checked as one unit and does not raise a
/// false "sentence should start with a capital" error.
///
/// Two adjacent blocks A, B are merged when either:
/// 1. they both fall inside a `force_regions` range (an explicit
///    `lang-check-begin block` … `lang-check-end` override), or
/// 2. they form a *natural continuation*: A does not end in sentence-terminal
///    punctuation (`.`, `!`, `?`), B begins with a lowercase letter, and no
///    blank line separates them.
///
/// Merging emits one `ProseRange` spanning both, with the inter-block markup
/// (and each block's own exclusions) recorded as exclusions so it is blanked to
/// spaces — never concatenating the prose across removed regions.
#[must_use]
pub fn merge_continuations(
    mut ranges: Vec<ProseRange>,
    text: &str,
    force_regions: &[std::ops::Range<usize>],
) -> Vec<ProseRange> {
    if ranges.len() < 2 {
        return ranges;
    }
    ranges.sort_by_key(|r| r.start_byte);

    let mut out: Vec<ProseRange> = Vec::with_capacity(ranges.len());
    for next in ranges {
        let merge = out.last().is_some_and(|prev| {
            in_same_force_region(prev, &next, force_regions)
                || is_natural_continuation(prev, &next, text)
        });
        if merge {
            let prev = out.last_mut().expect("merge implies a previous range");
            if prev.end_byte < next.start_byte {
                prev.exclusions.push((prev.end_byte, next.start_byte));
            }
            prev.exclusions.extend(next.exclusions.iter().copied());
            prev.end_byte = next.end_byte;
        } else {
            out.push(next);
        }
    }
    out
}

/// True when both blocks lie inside the same explicit force-merge region.
fn in_same_force_region(
    prev: &ProseRange,
    next: &ProseRange,
    force_regions: &[std::ops::Range<usize>],
) -> bool {
    force_regions
        .iter()
        .any(|r| r.contains(&prev.start_byte) && r.contains(&next.start_byte))
}

/// True when `next` reads as a natural continuation of `prev`: `prev` does not
/// end a sentence, `next` starts lowercase, and no blank line separates them.
fn is_natural_continuation(prev: &ProseRange, next: &ProseRange, text: &str) -> bool {
    // A blank line between the blocks is an explicit paragraph break.
    let gap = &text[prev.end_byte..next.start_byte];
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    // `prev` must not end in sentence-terminal punctuation.
    let prev_text = prev.extract_text(text);
    match prev_text.trim_end().chars().next_back() {
        Some('.' | '!' | '?') | None => return false,
        Some(_) => {}
    }

    // `next` must begin with a lowercase letter — the continuation signature.
    let next_text = next.extract_text(text);
    matches!(next_text.trim_start().chars().next(), Some(c) if c.is_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_skip_keeps_inline_space_bounds_tight() {
        // "ab #{G} cd" — the skip is the `#{G}` content at bytes [3, 8); the
        // flanking spaces (bytes 2 and 8) are plain spaces, so the exclusion must
        // NOT swallow them.
        let text = "ab #{G} cd";
        let mut ranges = [ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: Vec::new(),
        }];
        install_skip_exclusions(&mut ranges, &[(3, 7)], text.as_bytes());
        assert_eq!(ranges[0].exclusions, vec![(3, 7)]);
    }

    #[test]
    fn install_skip_absorbs_flanking_newline() {
        // "ab\n##\ncd" stand-in: skip at [3, 5) with a newline on each side; the
        // line breaks must be folded in so the next line isn't seen as a new
        // sentence. Bytes: a0 b1 \n2 #3 #4 \n5 c6 d7.
        let text = "ab\n##\ncd";
        let mut ranges = [ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: Vec::new(),
        }];
        install_skip_exclusions(&mut ranges, &[(3, 5)], text.as_bytes());
        // Grows left over '\n' (byte 2) and right over '\n' (byte 5).
        assert_eq!(ranges[0].exclusions, vec![(2, 6)]);
    }

    fn range(start: usize, end: usize) -> ProseRange {
        ProseRange {
            start_byte: start,
            end_byte: end,
            exclusions: Vec::new(),
        }
    }

    #[test]
    fn continuation_merges_lowercase_after_no_terminator() {
        //       0                17  19
        let text = "Here is something  continuation.";
        let merged = merge_continuations(vec![range(0, 17), range(19, 32)], text, &[]);
        assert_eq!(merged.len(), 1, "blocks should merge into one");
        assert_eq!((merged[0].start_byte, merged[0].end_byte), (0, 32));
        assert!(
            merged[0].exclusions.contains(&(17, 19)),
            "gap recorded as exclusion"
        );
    }

    #[test]
    fn no_merge_when_prev_ends_in_terminator() {
        let text = "First sentence. Second one.";
        let merged = merge_continuations(vec![range(0, 15), range(16, 27)], text, &[]);
        assert_eq!(merged.len(), 2, "terminal '.' blocks the merge");
    }

    #[test]
    fn no_merge_when_next_starts_uppercase() {
        let text = "here we go Now more";
        let merged = merge_continuations(vec![range(0, 10), range(11, 19)], text, &[]);
        assert_eq!(merged.len(), 2, "uppercase next start blocks the merge");
    }

    #[test]
    fn no_merge_across_blank_line() {
        let text = "here we go\n\nmore stuff";
        let merged = merge_continuations(vec![range(0, 10), range(12, 22)], text, &[]);
        assert_eq!(merged.len(), 2, "a blank line is a paragraph break");
    }

    #[test]
    fn force_region_overrides_heuristic() {
        // Terminal '.' and uppercase start would normally block the merge.
        let text = "First sentence. Second one.";
        let merged = merge_continuations(vec![range(0, 15), range(16, 27)], text, &[0..text.len()]);
        assert_eq!(
            merged.len(),
            1,
            "force region merges regardless of heuristic"
        );
    }

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
