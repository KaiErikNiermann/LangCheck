//! Keeping tree-sitter-rst linear on long unbroken runs.
//!
//! In a run of text with no whitespace, each `-`, `:` or `<` sends the
//! grammar's scanner looking ahead to the end of the run, so the parse costs
//! the number of those characters times the run's length. A 34 KB token such
//! as `lang-check-ignorelang-check-ignore...` took 8.4 seconds to parse, and
//! the editor checks on every save. No prose word is a kilobyte long, but a
//! minified line, a data URI or a pasted hash can be.
//!
//! [`break_long_runs`] replaces one of those characters with a space every
//! [`MAX_RUN`] bytes of such a run, which bounds each look-ahead. Same byte
//! length, so the tree's offsets are offsets into the original text, and a
//! run without any of them -- Chinese or Japanese prose, which has no
//! spaces -- is left alone, since it was never slow.

use std::borrow::Cow;

/// Unbroken bytes after which the next look-ahead trigger becomes a space.
pub const MAX_RUN: usize = 1024;

const fn triggers_look_ahead(byte: u8) -> bool {
    matches!(byte, b'-' | b':' | b'<')
}

/// `text` with long whitespace-free runs broken as described above. Borrowed
/// unchanged when no run is long enough, which is every ordinary document.
#[must_use]
pub fn break_long_runs(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let mut out: Option<Vec<u8>> = None;
    let mut run_start = 0;
    for (at, &byte) in bytes.iter().enumerate() {
        if byte.is_ascii_whitespace() {
            run_start = at + 1;
        } else if at - run_start >= MAX_RUN && triggers_look_ahead(byte) {
            out.get_or_insert_with(|| bytes.to_vec())[at] = b' ';
            run_start = at + 1;
        }
    }
    // Only ASCII bytes were replaced, and only with ASCII spaces, so the
    // buffer is still UTF-8.
    out.map_or(Cow::Borrowed(text), |buffer| {
        Cow::Owned(String::from_utf8(buffer).unwrap_or_else(|_| text.to_owned()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_document_is_not_copied() {
        let text = "Title\n=====\n\nSome prose with a :ref:`target` and a `link <https://example.com/a-b>`_.\n";
        assert!(matches!(break_long_runs(text), Cow::Borrowed(_)));
    }

    #[test]
    fn a_long_run_is_broken_every_max_run_bytes_at_a_trigger() {
        let text = "lang-check-ignore".repeat(2_000);
        let broken = break_long_runs(&text);
        assert_eq!(broken.len(), text.len(), "offsets must survive");
        let longest = broken.split(' ').map(str::len).max().unwrap_or(0);
        assert!(
            longest <= MAX_RUN + "lang-check-ignore".len(),
            "a run of {longest} bytes is left"
        );
    }

    #[test]
    fn a_long_run_without_triggers_is_left_alone() {
        let text = "\u{4e2d}\u{6587}\u{6587}\u{672c}".repeat(1_000);
        assert!(matches!(break_long_runs(&text), Cow::Borrowed(_)));
    }
}
