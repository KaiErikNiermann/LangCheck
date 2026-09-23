//! Keeping tree-sitter-md's block scanner inside its buffer.
//!
//! Between tokens the scanner saves its state by writing every open block --
//! each enclosing block quote and list item -- four bytes apiece into a
//! buffer tree-sitter fixes at 1024 bytes, without checking the size. The
//! 255th open block overruns it, tree-sitter asserts, and the process
//! aborts. A document nested that deep, or any such file the indexer opened,
//! took the whole core down, and an abort cannot be caught: the parser must
//! not be handed one.
//!
//! [`defang`] blanks the container markers on any line that could open more
//! than [`MAX_DEPTH`] blocks. Same byte length, so every offset into the
//! parse is an offset into the original text. Past the cap, the text reads
//! as indented continuation instead of as yet more nesting, which no real
//! document reaches.

use std::borrow::Cow;
use std::ops::Range;

/// Well under the 254 open blocks the scanner survives, leaving room for the
/// blocks that are not containers.
pub const MAX_DEPTH: usize = 128;

/// `text` with every container marker past [`MAX_DEPTH`] replaced by a
/// space. Borrowed unchanged when there is none, which is every ordinary
/// document.
#[must_use]
pub fn defang(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let mut out: Option<Vec<u8>> = None;
    let mut line_start = 0;
    while line_start < bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |at| line_start + at);
        for marker in excess_markers(&bytes[line_start..line_end]) {
            let buffer = out.get_or_insert_with(|| bytes.to_vec());
            buffer[line_start + marker.start..line_start + marker.end].fill(b' ');
        }
        line_start = line_end + 1;
    }
    // Only ASCII markers were replaced, and only with ASCII spaces, so the
    // buffer is still UTF-8.
    out.map_or(Cow::Borrowed(text), |buffer| {
        Cow::Owned(String::from_utf8(buffer).unwrap_or_else(|_| text.to_owned()))
    })
}

/// The markers in a line's container prefix that would take it past
/// [`MAX_DEPTH`].
///
/// Depth is bounded from above rather than computed, since computing it is
/// the scanner's job: each `>` and each list marker in the prefix can open
/// one block, and an enclosing list item takes at least two columns of
/// indentation, so a line cannot sit deeper than its markers plus half its
/// indentation. A lazy continuation line opens nothing, so bounding every
/// line bounds the document.
fn excess_markers(line: &[u8]) -> Vec<Range<usize>> {
    let mut columns = 0usize;
    let mut markers = 0usize;
    let mut excess = Vec::new();
    let mut at = 0;
    while at < line.len() {
        let marker_len = match line[at] {
            b' ' => {
                columns += 1;
                at += 1;
                continue;
            }
            b'\t' => {
                columns += 4 - columns % 4;
                at += 1;
                continue;
            }
            b'>' => 1,
            b'-' | b'+' | b'*' if ends_marker(line, at + 1) => 1,
            b'0'..=b'9' => match ordered_marker_len(line, at) {
                Some(len) => len,
                None => break,
            },
            _ => break,
        };
        markers += 1;
        if markers + columns / 2 > MAX_DEPTH {
            excess.push(at..at + marker_len);
        }
        at += marker_len;
    }
    excess
}

/// Whether a list marker ending before `at` is followed by what makes it one.
fn ends_marker(line: &[u8], at: usize) -> bool {
    line.get(at)
        .is_none_or(|&b| b == b' ' || b == b'\t' || b == b'\r')
}

/// The length of an ordered list marker (`12.` or `3)`) starting at `at`.
fn ordered_marker_len(line: &[u8], at: usize) -> Option<usize> {
    // CommonMark allows at most nine digits.
    let digits = line[at..]
        .iter()
        .take(10)
        .take_while(|b| b.is_ascii_digit())
        .count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let delimiter = *line.get(at + digits)?;
    ((delimiter == b'.' || delimiter == b')') && ends_marker(line, at + digits + 1))
        .then_some(digits + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_document_is_not_copied() {
        let text = "# Title\n\n> quoted\n> > nested\n\n- one\n  - two\n    1. three\n\nProse.\n";
        assert!(matches!(defang(text), Cow::Borrowed(_)));
    }

    #[test]
    fn deep_block_quotes_are_cut_at_the_cap() {
        let text = format!("{} Deep prose.\n", ">".repeat(400));
        let defanged = defang(&text);
        assert_eq!(defanged.len(), text.len(), "offsets must survive");
        assert_eq!(defanged.matches('>').count(), MAX_DEPTH);
        assert!(defanged.ends_with(" Deep prose.\n"));
    }

    #[test]
    fn deep_lists_are_cut_at_the_cap() {
        let text = (0..300)
            .map(|depth| format!("{}- item {depth}\n", "  ".repeat(depth)))
            .collect::<Vec<_>>()
            .concat();
        let defanged = defang(&text);
        assert_eq!(defanged.len(), text.len());
        // A line's indentation alone opens nothing, so the lines past the cap
        // lose their marker and become continuation text; the ones above it
        // keep theirs.
        for (depth, line) in defanged.lines().enumerate() {
            let has_marker = line.trim_start().starts_with("- ");
            assert_eq!(has_marker, depth < MAX_DEPTH, "line {depth}: {line:?}");
        }
    }

    #[test]
    fn ordered_markers_count_and_emphasis_does_not() {
        assert_eq!(ordered_marker_len(b"12. x", 0), Some(3));
        assert_eq!(ordered_marker_len(b"3) x", 0), Some(2));
        assert_eq!(ordered_marker_len(b"1234567890. x", 0), None);
        assert_eq!(ordered_marker_len(b"3.14", 0), None);
        assert!(excess_markers(b"*emphasis*").is_empty());
    }
}
