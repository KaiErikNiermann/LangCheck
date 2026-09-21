//! Shared prose extraction utilities used by language-specific extractors.
//!
//! The merge/bridge logic is identical across forester, tinylang, and latex
//! extractors. This module provides the common implementation, parameterized
//! by language-specific noise stripping and exclusion collection callbacks.

use super::{ProseRange, gap};

/// The first direct child of `node` with the given kind.
///
/// Every extractor needs this to read one labelled part of a structured node --
/// a directive's `type`, a block's name, a command's `command_name` -- and a
/// private `for` loop per call site is how they drift.
#[must_use]
pub fn child_of_kind<'t>(node: tree_sitter::Node<'t>, kind: &str) -> Option<tree_sitter::Node<'t>> {
    let mut cursor = node.walk();
    node.children(&mut cursor).find(|c| c.kind() == kind)
}

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
/// - `syntax`: the language's gap syntax — see [`super::gap`]. Both questions a
///   gap answers, "do these words bridge" and "what must the checker not see",
///   are derived from it, so there is no second scanner to keep in step.
pub fn merge_ranges(words: &[(usize, usize)], text: &str, syntax: gap::Syntax) -> Vec<ProseRange> {
    if words.is_empty() {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut chunk_start = words[0].0;
    let mut chunk_end = words[0].1;
    let mut exclusions: Vec<(usize, usize)> = Vec::new();

    for &(start, end) in &words[1..] {
        let gap = &text[chunk_end..start];

        if is_bridgeable_gap(gap, syntax) {
            gap::exclusions(gap, chunk_end, syntax, &mut exclusions);
        } else {
            ranges.push(ProseRange {
                start_byte: chunk_start,
                end_byte: chunk_end,
                exclusions: std::mem::take(&mut exclusions),
                language: None,
                language_span: None,
            });
            chunk_start = start;
        }
        chunk_end = end;
    }

    ranges.push(ProseRange {
        start_byte: chunk_start,
        end_byte: chunk_end,
        exclusions,
        language: None,
        language_span: None,
    });

    ranges
}

/// Check if a gap between two text ranges can be bridged into one prose chunk.
///
/// Returns `false` for paragraph breaks (`\n\n`). After stripping the language's
/// markup, the remaining characters must all be whitespace or punctuation.
fn is_bridgeable_gap(gap: &str, syntax: gap::Syntax) -> bool {
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    let stripped = gap::strip(gap, syntax);

    // After stripping language-specific noise, a paragraph break may be
    // revealed (e.g. a comment on its own line: \n// comment\n → \n\n).
    if stripped.contains("\n\n") || stripped.contains("\r\n\r\n") {
        return false;
    }

    stripped.chars().all(is_bridge_char)
}

// ---------------------------------------------------------------------------
// Linear scanning utilities
// ---------------------------------------------------------------------------

/// End of the run of items from `i` that satisfy `matches`.
///
/// Every gap scanner walks a command name, a delimiter run or a comment this
/// way. Written out per site it is a `while` with a bounds check that is easy
/// to drop; here the bound is stated once. Generic over the item type because
/// the scanners work on `&[u8]` or `&[char]` depending on whether the markup
/// they read can be non-ASCII.
pub fn run_end<T: Copy>(items: &[T], mut i: usize, matches: impl Fn(T) -> bool) -> usize {
    while i < items.len() && matches(items[i]) {
        i += 1;
    }
    i
}

/// End of the run from `from` up to and *including* the next `close`.
///
/// An unterminated run ends at the end of `bytes`, which is what an unclosed
/// `$…` or `` `… `` in a gap should do: consume the rest rather than nothing.
/// The gap is already bounded, and over-excluding beats checking the inside of
/// broken markup.
///
/// `escape` is the byte that hides the one after it (LaTeX's `\`), or `None`
/// for a language without one. A closer that itself starts with the escape byte
/// (`\]`, `\)`) cannot honour it, or the scan would skip its own terminator,
/// so the escape is ignored in that case.
pub fn close_at(bytes: &[u8], from: usize, close: &[u8], escape: Option<u8>) -> usize {
    let escape = escape.filter(|&e| close.first() != Some(&e));
    let mut i = from;
    while i + close.len() <= bytes.len() {
        if escape == Some(bytes[i]) {
            i += 2;
            continue;
        }
        if bytes[i..].starts_with(close) {
            return i + close.len();
        }
        i += 1;
    }
    bytes.len()
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

/// Split ranges longer than `limit` bytes into several, at sentence bounds.
///
/// A prose range is the unit of three things at once: one cache key, one
/// engine request, and one box in the inspector. A document whose author does
/// not leave a blank line between paragraphs -- soft-wrapped prose, a
/// generated file, a single long note -- extracts as ONE range covering the
/// whole thing, and all three collapse with it. Measured on 30 kB of
/// soft-wrapped Typst against a 4-CPU `LanguageTool`: 341 ms per keystroke
/// with the result cache on, against 35 ms for the same text with blank
/// lines, because every keystroke dirties the single key and re-sends
/// everything.
///
/// Splitting costs nothing on a cold check, because
/// [`crate::engines`] packs ranges back together up to its own request size —
/// the chunks exist for cache granularity, not for the wire.
///
/// Sentence boundaries are preferred so each chunk is whole sentences and the
/// cross-sentence rules still see what they need; failing that a word
/// boundary, and failing that a character boundary, because a range that
/// cannot be split is a range that goes back to being unsplittable. A split is
/// never placed inside an exclusion.
#[must_use]
pub fn split_oversized(ranges: Vec<ProseRange>, text: &str, limit: usize) -> Vec<ProseRange> {
    if limit == 0 {
        return ranges;
    }
    let mut out = Vec::with_capacity(ranges.len());
    for range in ranges {
        if range.end_byte - range.start_byte <= limit {
            out.push(range);
            continue;
        }
        let mut start = range.start_byte;
        while range.end_byte - start > limit {
            let cut = split_point(text, start, start + limit, &range.exclusions);
            // No usable cut before the limit: the rest travels as one piece
            // rather than looping forever on a range that will not divide.
            if cut <= start {
                break;
            }
            out.push(chunk_of(&range, start, cut));
            start = cut;
        }
        out.push(chunk_of(&range, start, range.end_byte));
    }
    out
}

/// One piece of a split range, taking the exclusions that fall inside it.
fn chunk_of(range: &ProseRange, start: usize, end: usize) -> ProseRange {
    ProseRange {
        start_byte: start,
        end_byte: end,
        exclusions: range
            .exclusions
            .iter()
            .filter(|&&(es, ee)| es < end && ee > start)
            .map(|&(es, ee)| (es.max(start), ee.min(end)))
            .collect(),
        language: range.language.clone(),
        language_span: None,
    }
}

/// Where to cut a range that runs past `limit`, searching back from it.
///
/// Returns `from` when nothing usable was found, which the caller reads as
/// "do not split".
fn split_point(text: &str, from: usize, limit: usize, exclusions: &[(usize, usize)]) -> usize {
    let hard_end = limit.min(text.len());
    let in_exclusion = |at: usize| exclusions.iter().any(|&(es, ee)| at > es && at < ee);

    // A sentence end: terminator, then the whitespace after it.
    let window = &text[from..hard_end];
    let mut sentence = None;
    let mut word = None;
    for (offset, ch) in window.char_indices() {
        let at = from + offset;
        if !ch.is_whitespace() {
            continue;
        }
        // The split goes after the whitespace run, so the next chunk starts on
        // a word rather than on the space before it.
        let after = at + ch.len_utf8();
        if after <= from || in_exclusion(after) {
            continue;
        }
        let terminated = text[..at]
            .chars()
            .next_back()
            .is_some_and(|c| matches!(c, '.' | '!' | '?' | '\u{2026}'));
        if terminated {
            sentence = Some(after);
        }
        word = Some(after);
    }

    if let Some(at) = sentence {
        return at;
    }
    if let Some(at) = word {
        return at;
    }
    // Neither: cut on a character boundary so a single enormous token still
    // divides rather than defeating the whole pass.
    let mut at = hard_end;
    while at > from && !text.is_char_boundary(at) {
        at -= 1;
    }
    if in_exclusion(at) { from } else { at }
}

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
            // Two languages never merge: a French sentence and the English
            // clause quoted inside it are one paragraph to the typesetter and
            // two different checks here.
            if prev.language != next.language {
                return false;
            }
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
            language: None,
            language_span: None,
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
            language: None,
            language_span: None,
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
            language: None,
            language_span: None,
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
    fn test_skip_balanced_bytes_past_non_ascii() {
        // The scanner counts bytes, so multi-byte text inside the braces must
        // not shift where the closer is found.
        let b = "{äöü}rest".as_bytes();
        assert_eq!(skip_balanced_bytes(b, 1, b'{', b'}', None), 8);
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
    fn test_dedup_exclusions_merges_overlapping() {
        let mut ranges = vec![ProseRange {
            start_byte: 0,
            end_byte: 100,
            exclusions: vec![(10, 30), (10, 25), (20, 40), (50, 60)],
            language: None,
            language_span: None,
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
            language: None,
            language_span: None,
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
            language: None,
            language_span: None,
        };
        assert!(is_fully_excluded(&r));
    }

    #[test]
    fn test_is_fully_excluded_gap() {
        let r = ProseRange {
            start_byte: 10,
            end_byte: 50,
            exclusions: vec![(10, 30), (35, 50)],
            language: None,
            language_span: None,
        };
        assert!(!is_fully_excluded(&r));
    }

    #[test]
    fn test_is_fully_excluded_empty() {
        let r = ProseRange {
            start_byte: 10,
            end_byte: 50,
            exclusions: vec![],
            language: None,
            language_span: None,
        };
        assert!(!is_fully_excluded(&r));
    }

    /// `(text, byte span)` for each chunk, so a test reads as the split it
    /// describes.
    fn split_texts(text: &str, limit: usize, exclusions: Vec<(usize, usize)>) -> Vec<String> {
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions,
            language: None,
            language_span: None,
        };
        split_oversized(vec![range], text, limit)
            .iter()
            .map(|r| text[r.start_byte..r.end_byte].to_string())
            .collect()
    }

    #[test]
    fn a_range_within_the_limit_is_left_alone() {
        let text = "One sentence. Two sentence.";
        assert_eq!(split_texts(text, 4096, Vec::new()), vec![text]);
    }

    #[test]
    fn a_zero_limit_disables_splitting() {
        let text = "One sentence. Two sentence. Three sentence.";
        assert_eq!(split_texts(text, 0, Vec::new()), vec![text]);
    }

    #[test]
    fn a_long_range_splits_after_a_sentence() {
        let text = "One sentence here. Two sentence here. Three sentence here.";
        let chunks = split_texts(text, 30, Vec::new());
        assert!(chunks.len() > 1, "expected a split, got {chunks:?}");
        // Every chunk but the last ends where a sentence ended.
        for chunk in &chunks[..chunks.len() - 1] {
            assert!(
                chunk.trim_end().ends_with('.'),
                "chunk does not end on a sentence: {chunk:?}"
            );
        }
        assert_eq!(chunks.concat(), text, "splitting must not lose or add text");
    }

    #[test]
    fn a_range_with_no_sentence_end_splits_on_a_word() {
        let text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
        let chunks = split_texts(text, 20, Vec::new());
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
        for chunk in &chunks {
            assert!(!chunk.starts_with(' '), "a chunk begins mid-gap: {chunk:?}");
        }
    }

    #[test]
    fn a_single_enormous_token_still_divides() {
        // No sentence end and no space: the fallback is a character boundary,
        // so one unsplittable token cannot defeat the whole pass.
        let text = "a".repeat(100);
        let chunks = split_texts(&text, 20, Vec::new());
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn splitting_never_lands_inside_an_exclusion() {
        //                     0123456789012345678901234567890123456789
        let text = "Start here. $a + b = c$ and more text after it.";
        let math = (12, 23);
        for chunk in split_oversized(
            vec![ProseRange {
                start_byte: 0,
                end_byte: text.len(),
                exclusions: vec![math],
                language: None,
                language_span: None,
            }],
            text,
            16,
        ) {
            assert!(
                chunk.start_byte <= math.0 || chunk.start_byte >= math.1,
                "a chunk starts inside the exclusion at {}",
                chunk.start_byte
            );
        }
    }

    #[test]
    fn each_chunk_keeps_the_exclusions_that_fall_in_it() {
        let text = "Alpha $x$ beta. Gamma $y$ delta. Epsilon $z$ zeta.";
        let ranges = split_oversized(
            vec![ProseRange {
                start_byte: 0,
                end_byte: text.len(),
                exclusions: vec![(6, 9), (22, 25), (40, 43)],
                language: None,
                language_span: None,
            }],
            text,
            20,
        );
        assert!(ranges.len() > 1);
        for range in &ranges {
            for &(es, ee) in &range.exclusions {
                assert!(
                    es >= range.start_byte && ee <= range.end_byte,
                    "exclusion {es}..{ee} escapes its chunk {}..{}",
                    range.start_byte,
                    range.end_byte
                );
            }
        }
        let kept: usize = ranges.iter().map(|r| r.exclusions.len()).sum();
        assert_eq!(kept, 3, "every exclusion belongs to exactly one chunk");
    }

    #[test]
    fn a_chunk_inherits_the_language_of_the_range_it_came_from() {
        let text = "Une phrase ici. Une autre phrase ici. Et une troisieme phrase ici.";
        let ranges = split_oversized(
            vec![ProseRange {
                start_byte: 0,
                end_byte: text.len(),
                exclusions: Vec::new(),
                language: Some("fr".to_string()),
                language_span: None,
            }],
            text,
            24,
        );
        assert!(ranges.len() > 1);
        assert!(ranges.iter().all(|r| r.language.as_deref() == Some("fr")));
    }

    #[test]
    fn splitting_is_stable_under_an_edit_elsewhere() {
        // The point of splitting is cache granularity, so a chunk the edit did
        // not touch has to come out byte-identical or it is a cache miss.
        let mut base = String::new();
        for i in 0..40 {
            use std::fmt::Write as _;
            let _ = write!(base, "Sentence number {i} in this paragraph. ");
        }
        let before = split_texts(&base, 512, Vec::new());
        let mut edited = base.clone();
        edited.insert_str(20, "inserted ");
        let after = split_texts(&edited, 512, Vec::new());

        let unchanged = after.iter().filter(|c| before.contains(c)).count();
        assert!(
            unchanged * 4 >= after.len() * 3,
            "only {unchanged}/{} chunks survived the edit; splitting is cascading",
            after.len()
        );
    }
}

/// Move a range's start past anything that would reach an engine as blanks.
///
/// An excluded span is replaced with spaces so byte offsets stay stable, which
/// is right in the middle of a paragraph and wrong at its start: the engines
/// are then handed text that opens with a run of whitespace. Harper reads the
/// next hard line break in such a run as a sentence boundary, so the second
/// line of every wrapped paragraph that opens with a code span, a link whose
/// text is one, or a bold word was reported as a sentence that does not start
/// with a capital letter.
///
/// Only the leading run moves. A blank in the middle is what keeps the offsets
/// of everything after it correct, and the trailing end is already trimmed by
/// the callers that care.
pub fn trim_leading_blanks(range: &mut crate::prose::ProseRange, text: &str) {
    loop {
        let start = range.start_byte;
        if start >= range.end_byte {
            return;
        }
        // An exclusion covering the first byte contributes only spaces.
        if let Some(&(_, exc_end)) = range
            .exclusions
            .iter()
            .find(|&&(exc_start, exc_end)| exc_start <= start && exc_end > start)
        {
            range.start_byte = exc_end.min(range.end_byte);
            continue;
        }
        // Literal whitespace before the first word is not prose either, and a
        // space left between an exclusion and the word after it would keep
        // the run alive.
        let rest = &text[start..range.end_byte];
        let trimmed = rest.len() - rest.trim_start_matches([' ', '\t']).len();
        if trimmed > 0 {
            range.start_byte = start + trimmed;
            continue;
        }
        break;
    }
    // Exclusions the start has moved past are no longer inside the range.
    let start = range.start_byte;
    range.exclusions.retain(|&(_, exc_end)| exc_end > start);
    for exclusion in &mut range.exclusions {
        exclusion.0 = exclusion.0.max(start);
    }
}
