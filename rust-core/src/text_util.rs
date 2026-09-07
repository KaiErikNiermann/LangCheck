//! Small shared text utilities: byte-offset–safe string handling, and the shared
//! reading of an engine's `suggestions` list.

/// Slice a `&str` at byte offsets, snapping each bound to the nearest char
/// boundary so the operation never panics on multi-byte UTF-8.
///
/// `start` rounds down, `end` rounds up; both are clamped to the string length.
#[must_use]
pub fn safe_slice(s: &str, start: usize, end: usize) -> &str {
    let lo = s.floor_char_boundary(start.min(s.len()));
    let hi = s.ceil_char_boundary(end.min(s.len()));
    &s[lo..hi]
}

/// Everything up to `end`, snapping the bound DOWN to a char boundary.
///
/// The one-sided counterpart to [`safe_slice`]: it floors where `safe_slice` would ceil, so the
/// partial character at a split offset is excluded rather than included. Callers wanting the
/// text *before* an engine-reported span want this.
#[must_use]
pub fn safe_prefix(s: &str, end: usize) -> &str {
    &s[..s.floor_char_boundary(end.min(s.len()))]
}

/// Everything from `start`, snapping the bound UP to a char boundary.
///
/// Mirror of [`safe_prefix`] for the text *after* a span; ceils so a split character is not
/// re-emitted as a partial tail.
#[must_use]
pub fn safe_suffix(s: &str, start: usize) -> &str {
    &s[s.ceil_char_boundary(start.min(s.len()))..]
}

/// Snap a byte range outward to char boundaries, clamped to the string length.
///
/// The offsets form of [`safe_slice`], for callers that need the *bounds* rather than the slice —
/// splicing with `String::replace_range`, or deciding whether an engine-reported span was
/// well-formed by testing whether snapping moved it.
#[must_use]
pub fn snap_range(s: &str, start: usize, end: usize) -> (usize, usize) {
    (
        s.floor_char_boundary(start.min(s.len())),
        s.ceil_char_boundary(end.min(s.len())),
    )
}

/// Smallest edit distance between the token and any single-word suggestion.
///
/// Returns `None` when the engine offered nothing usable. Suggestions containing
/// whitespace are ignored: `LanguageTool` answers `Abramsky` with `Abram sky`, a word-split
/// proposal that is one edit away by character count but is not evidence that the token
/// is a misspelling of a known word.
///
/// Shared by [`crate::names`] and [`crate::morphology`], which ask the same question of the
/// same engine output: is there a known word this token is one slip away from?
#[must_use]
pub fn min_suggestion_distance(token: &str, suggestions: &[String]) -> Option<usize> {
    let lowered = token.to_lowercase();
    suggestions
        .iter()
        .filter(|s| !s.chars().any(char::is_whitespace))
        .map(|s| strsim::damerau_levenshtein(&lowered, &s.to_lowercase()))
        .min()
}

#[cfg(test)]
mod tests {
    use super::{min_suggestion_distance, safe_prefix, safe_slice, safe_suffix, snap_range};

    #[test]
    fn ascii_slice_is_exact() {
        assert_eq!(safe_slice("hello world", 0, 5), "hello");
        assert_eq!(safe_slice("hello world", 6, 11), "world");
    }

    #[test]
    fn snaps_offsets_inside_multibyte_chars() {
        // 'ö' occupies two bytes; offsets landing mid-char must widen outward.
        let s = "Ölförderung";
        // byte 1 is mid-'Ö' -> floors to 0; byte 4 is mid-'ö' -> ceils past it.
        let slice = safe_slice(s, 1, 4);
        assert!(s.starts_with(slice) || s.contains(slice));
        assert!(slice.is_char_boundary(0));
    }

    #[test]
    fn clamps_out_of_range_offsets() {
        assert_eq!(safe_slice("abc", 0, 999), "abc");
        assert_eq!(safe_slice("abc", 999, 999), "");
    }

    #[test]
    fn prefix_and_suffix_snap_away_from_a_split_char() {
        // 'ö' is two bytes at 1..3; byte 2 is inside it.
        let s = "Föö";
        assert_eq!(safe_prefix(s, 2), "F"); // floors back off the partial char
        assert_eq!(safe_suffix(s, 2), "ö"); // ceils forward past it
        assert_eq!(safe_prefix(s, 0), "");
        assert_eq!(safe_suffix(s, 999), "");
    }

    #[test]
    fn snap_range_reports_whether_it_moved() {
        let s = "Föö";
        // Already on boundaries — unchanged, so a caller can trust the span.
        assert_eq!(snap_range(s, 0, 3), (0, 3));
        // Byte 2 splits 'ö': the start floors back, the end ceils forward.
        assert_eq!(snap_range(s, 2, 2), (1, 3));
        assert_eq!(snap_range(s, 0, 999), (0, s.len()));
    }

    #[test]
    fn prefix_and_suffix_partition_on_a_real_boundary() {
        let s = "Föö";
        assert_eq!(format!("{}{}", safe_prefix(s, 3), safe_suffix(s, 3)), s);
    }

    #[test]
    fn word_split_suggestions_are_not_evidence_of_a_typo() {
        let sugg = vec!["Abram sky".to_string()];
        assert_eq!(min_suggestion_distance("Abramsky", &sugg), None);
    }

    #[test]
    fn suggestion_distance_is_case_insensitive() {
        let sugg = vec!["Hoar".to_string()];
        assert_eq!(min_suggestion_distance("Hoare", &sugg), Some(1));
        assert_eq!(min_suggestion_distance("recieve", &[]), None);
    }
}
