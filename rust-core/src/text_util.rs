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

/// Unwrap a line's comment syntax and hand the content inside to `parse`.
///
/// Both directive readers -- the scope markers in [`crate::scoping`] and the
/// `lang-check-*` directives in [`crate::ignore_rules`] -- accept the same four
/// spellings of a comment, and differ only in what they do with the text
/// inside. The four are `<!-- ... -->`, `// ...`, `/* ... */` and `% ...`,
/// covering Markdown and HTML, the C-family markup languages, and LaTeX.
///
/// Returns `None` when the line is not a comment, or when `parse` rejects
/// what was inside one.
pub fn in_comment<T>(line: &str, parse: impl Fn(&str) -> Option<T>) -> Option<T> {
    let trimmed = line.trim();

    if let Some(rest) = trimmed.strip_prefix("<!--")
        && let Some(inner) = rest.strip_suffix("-->")
    {
        return parse(inner.trim());
    }

    if let Some(rest) = trimmed.strip_prefix("//") {
        return parse(rest.trim());
    }

    if let Some(rest) = trimmed.strip_prefix("/*")
        && let Some(inner) = rest.strip_suffix("*/")
    {
        return parse(inner.trim());
    }

    if let Some(rest) = trimmed.strip_prefix('%') {
        return parse(rest.trim());
    }

    None
}

/// Tracks whether a line falls inside a fenced code block.
///
/// A directive written inside a fence is an example of a directive, not one.
/// The language guide demonstrates the scope marker by showing
/// ` ```markdown ` … `<!-- lang: fr -->` … ` ``` `, and without this the
/// marker was obeyed: everything after it in the file was checked as French,
/// so the page documenting the feature was the page the feature broke.
///
/// Fences are recognised the way `CommonMark` defines them -- three or more
/// backticks or tildes, indented no more than three spaces, closed by at
/// least as many of the same character with nothing after them. Typst raw
/// blocks use the same delimiters, and a format with no fences at all simply
/// never opens one.
#[derive(Debug, Default)]
pub struct FenceTracker {
    /// The character and length of the fence currently open.
    open: Option<(u8, usize)>,
}

impl FenceTracker {
    #[must_use]
    pub const fn new() -> Self {
        Self { open: None }
    }

    /// Feed the next line; returns whether it is inside a fence.
    ///
    /// The fence lines themselves count as inside, because a directive can
    /// only ever be on one of them by accident.
    pub fn consume(&mut self, line: &str) -> bool {
        let Some((marker, run)) = fence_run(line) else {
            return self.open.is_some();
        };

        // A closing fence matches the opener's character and is at least as
        // long, with nothing after it. Anything else inside a fence -- a ```
        // run within a ~~~ block, say -- is just content.
        if let Some((open_marker, open_run)) = self.open {
            if marker == open_marker && run >= open_run && info_string(line, marker).is_empty() {
                self.open = None;
            }
        } else {
            self.open = Some((marker, run));
        }
        true
    }

    /// Whether a fence is currently open.
    #[must_use]
    pub const fn inside(&self) -> bool {
        self.open.is_some()
    }
}

/// The fence character and its run length, when a line opens or closes one.
fn fence_run(line: &str) -> Option<(u8, usize)> {
    let indent = line.len() - line.trim_start().len();
    // More than three spaces of indent makes it an indented code block, not a
    // fence.
    if indent > 3 {
        return None;
    }
    let rest = line.trim_start();
    let marker = match rest.as_bytes().first() {
        Some(&b'`') => b'`',
        Some(&b'~') => b'~',
        _ => return None,
    };
    let run = rest.bytes().take_while(|&b| b == marker).count();
    (run >= 3).then_some((marker, run))
}

/// Whatever follows the fence characters, trimmed.
fn info_string(line: &str, marker: u8) -> &str {
    line.trim_start().trim_start_matches(marker as char).trim()
}
