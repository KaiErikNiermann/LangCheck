//! The gap between two prose words, and what a markup language puts there.
//!
//! Extraction collects the words that carry prose. Everything between two of
//! them is a *gap*, and a gap decides two things:
//!
//! - whether the words on either side belong to one prose block, answered by
//!   stripping the gap's markup and looking at what is left;
//! - which byte ranges the checker must not see, so that a formula or a command
//!   name is not reported as a spelling mistake.
//!
//! Both answers come from the same question — "what token starts here?" — so a
//! language describes its gap syntax once, as a [`Syntax`] function, and
//! [`strip`] and [`exclusions`] derive the rest.
//!
//! # Adding a language
//!
//! Write one function of the shape [`Syntax`]: given the gap's bytes and an
//! offset, return the token that starts there, or `None` when the byte is
//! ordinary text. Then pass it to [`super::shared::merge_ranges`]. That is the
//! whole surface — there is no second scanner to keep in step, which is what
//! this module exists to prevent.
//!
//! A matcher is written as a `match` on `bytes[i..]` so the slice patterns
//! carry the bounds checks, and the arms are ordered longest-prefix first
//! (`##{` before `#{`, `\name` before `\x`).

/// What the checker should see in place of a token.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Token {
    /// Carries no prose but separates the words around it: math, a verbatim
    /// span, a code span. Stripped to a space, so `a $x$ b` still reads as one
    /// sentence rather than as `ab`.
    Separator,
    /// Invisible in the rendered document: a command name, an escape, a comment.
    /// Stripped to nothing, so `\emph{a}b` reads as `ab`.
    Elided,
    /// Block-level structure — the words on either side are in different
    /// paragraphs. Kept verbatim in the stripped gap so the bridge check sees
    /// it and refuses to join them.
    Barrier,
}

/// One recognized token: its kind and the bytes it covers.
///
/// `start` may lie *before* the offset the token was recognized at. LaTeX
/// display math reaches back for the whitespace around it, so that blanking the
/// formula does not leave a double space in the middle of a sentence.
#[derive(Clone, Copy, Debug)]
pub struct Match {
    pub token: Token,
    pub start: usize,
    pub end: usize,
}

impl Match {
    /// A token covering `start..end`.
    #[must_use]
    pub const fn new(token: Token, start: usize, end: usize) -> Self {
        Self { token, start, end }
    }

    /// A token covering `at..end` — the common case, where the token begins
    /// exactly where it was recognized.
    #[must_use]
    pub const fn at(token: Token, at: usize, end: usize) -> Self {
        Self::new(token, at, end)
    }
}

/// Recognizes the token starting at `bytes[i]`, or `None` when that byte is
/// ordinary text.
///
/// Called only with `i < bytes.len()` and `i` on a character boundary. The
/// returned `end` must be greater than `i`, or the scan cannot make progress.
pub type Syntax = fn(&[u8], usize) -> Option<Match>;

/// The gap with its markup removed, for the bridge check.
///
/// [`Token::Separator`] becomes a space, [`Token::Elided`] disappears, and
/// [`Token::Barrier`] is copied through unchanged so the caller's bridge test
/// rejects the gap.
#[must_use]
pub fn strip(gap: &str, syntax: Syntax) -> String {
    let bytes = gap.as_bytes();
    let mut out = String::with_capacity(gap.len());
    let mut i = 0;
    while i < bytes.len() {
        let Some(found) = syntax(bytes, i) else {
            // Ordinary text — copy the whole run in one go rather than a
            // character at a time.
            let start = i;
            loop {
                i = next_boundary(bytes, i);
                if i >= bytes.len() || syntax(bytes, i).is_some() {
                    break;
                }
            }
            out.push_str(&gap[start..i]);
            continue;
        };
        match found.token {
            Token::Separator => out.push(' '),
            Token::Elided => {}
            Token::Barrier => out.push_str(&gap[i..found.end]),
        }
        i = found.end;
    }
    out
}

/// The gap's tokens as exclusion ranges, offset into the document.
///
/// The ranges come out sorted and disjoint: a token that reaches back for the
/// whitespace before it is clamped to where the previous token ended, so the
/// two never overlap.
pub fn exclusions(gap: &str, offset: usize, syntax: Syntax, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    let mut previous_end = 0;
    while i < bytes.len() {
        let Some(found) = syntax(bytes, i) else {
            i = next_boundary(bytes, i);
            continue;
        };
        let start = found.start.max(previous_end);
        if start < found.end {
            out.push((offset + start, offset + found.end));
            previous_end = found.end;
        }
        i = found.end;
    }
}

/// The next character boundary after `i`.
///
/// Token matchers key on ASCII, so stepping a character at a time is what keeps
/// every slice in [`strip`] on a boundary even when the prose around the markup
/// is not ASCII.
const fn next_boundary(bytes: &[u8], i: usize) -> usize {
    let mut j = i + 1;
    while j < bytes.len() && bytes[j] & 0b1100_0000 == 0b1000_0000 {
        j += 1;
    }
    j
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A toy syntax: `$…$` separates, `\x` elides, `|` is a barrier.
    fn toy(bytes: &[u8], i: usize) -> Option<Match> {
        Some(match bytes[i..] {
            [b'$', ..] => Match::at(
                Token::Separator,
                i,
                super::super::shared::close_at(bytes, i + 1, b"$", None),
            ),
            [b'\\', _, ..] => Match::at(Token::Elided, i, i + 2),
            [b'|', ..] => Match::at(Token::Barrier, i, i + 1),
            _ => return None,
        })
    }

    #[test]
    fn strip_applies_one_rule_per_token_kind() {
        assert_eq!(strip("a $x$ b", toy), "a   b");
        assert_eq!(strip("a \\q b", toy), "a  b");
        assert_eq!(strip("a | b", toy), "a | b");
    }

    #[test]
    fn strip_keeps_non_ascii_text_intact() {
        assert_eq!(strip("ä ö $x$ ü", toy), "ä ö   ü");
    }

    #[test]
    fn exclusions_are_sorted_and_disjoint() {
        let mut out = Vec::new();
        exclusions("a $x$ \\q |", 100, toy, &mut out);
        assert_eq!(out, vec![(102, 105), (106, 108), (109, 110)]);
    }

    #[test]
    fn exclusions_clamp_a_token_that_reaches_backwards() {
        /// Every `!` claims the byte before it as well.
        fn greedy(bytes: &[u8], i: usize) -> Option<Match> {
            match bytes[i..] {
                [b'!', ..] => Some(Match::new(Token::Separator, i.saturating_sub(1), i + 1)),
                _ => None,
            }
        }
        let mut out = Vec::new();
        exclusions("!!", 0, greedy, &mut out);
        assert_eq!(
            out,
            vec![(0, 1), (1, 2)],
            "the second token must not reach back into the first"
        );
    }

    #[test]
    fn an_unterminated_token_consumes_the_rest() {
        assert_eq!(strip("a $x", toy), "a  ");
    }
}
