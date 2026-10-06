//! Recognition of tokens whose shape marks them as identifiers rather than words.
//!
//! `parse_json_blob`, `getElementById` and `LanguageTool` turn up in prose all the time:
//! bare in a code comment, unquoted in a README, or as a product name. None of them is a
//! word, so nothing an engine says about one is worth showing. Their shape alone says so,
//! which makes this the one suppression that needs no dictionary, no suggestions and no
//! context.
//!
//! # The flagged span is not the token
//!
//! Both engines split on underscores: given `parse_json_blob`, Harper reports `json` as a
//! capitalisation error and `LanguageTool` reports it as a misspelling. Neither ever sees
//! the identifier whole, so the span is widened to the run of word characters around it
//! before its shape is judged. camelCase is reported whole by both, which the widening
//! leaves unchanged.
//!
//! # Shapes
//!
//! - **snake** — an underscore *between* two word characters: `foo_bar`, `MAX_RETRIES`.
//!   An underscore at the edge does not count, because Markdown emphasis puts one there
//!   (`_teh_`) and a typo inside emphasis must stay visible. Dunders like `__init__` are
//!   lost to the same rule; `__bold__` is indistinguishable from them in the source.
//! - **camel** — a lowercase letter directly followed by an uppercase one, anywhere in the
//!   token: `fooBar`, `GitHub`, `iPhone`, `XMLHttpRequest`. A digit followed by an uppercase
//!   letter counts when a lowercase letter came earlier (`base64Encode`), so `3D` does not.
//!
//! kebab-case is deliberately not a shape: `well-known` is English.
//!
//! # Casing slips
//!
//! A shift-key slip produces the camel shape too: `tHe`. The difference is that a slip is
//! a real word in the wrong case, and the engine says so by suggesting that word. So a
//! camel token is not treated as an identifier when a suggestion matches it ignoring case.
//! snake has no such exception, since no slip types an underscore.

use crate::text_util::min_suggestion_distance;

/// Which shape made a token an identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentifierShape {
    /// An internal underscore: `foo_bar`.
    Snake,
    /// A lower-to-upper case transition: `fooBar`, `FooBar`.
    Camel,
}

impl IdentifierShape {
    /// The shape of a whole token, if it has one.
    #[must_use]
    pub fn of(token: &str) -> Option<Self> {
        let chars: Vec<char> = token.chars().collect();
        let snake = chars
            .windows(3)
            .any(|w| w[1] == '_' && w[0].is_alphanumeric() && w[2].is_alphanumeric());
        if snake && chars.iter().any(|c| c.is_alphabetic()) {
            return Some(Self::Snake);
        }
        let camel = chars.windows(2).enumerate().any(|(i, w)| {
            w[1].is_uppercase()
                && (w[0].is_lowercase()
                    || (w[0].is_numeric() && chars[..i].iter().any(|c| c.is_lowercase())))
        });
        camel.then_some(Self::Camel)
    }

    /// The tag used in logs.
    #[must_use]
    pub const fn tag(self) -> &'static str {
        match self {
            Self::Snake => "snake",
            Self::Camel => "camel",
        }
    }
}

/// An identifier-shaped token in a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identifier<'a> {
    pub token: &'a str,
    pub shape: IdentifierShape,
}

impl Identifier<'_> {
    /// The identifier enclosing `text[start..end]`, if the span lies inside one.
    ///
    /// The span must consist of word characters only: a diagnostic that reaches past the
    /// token is about more than the token, and is not this module's to judge. Offsets that
    /// are out of range or split a character answer `None`.
    #[must_use]
    pub fn enclosing(text: &str, start: usize, end: usize) -> Option<Identifier<'_>> {
        let span = text.get(start..end)?;
        if span.is_empty() || !span.chars().all(is_word_char) {
            return None;
        }
        let from = text[..start]
            .char_indices()
            .rev()
            .take_while(|&(_, c)| is_word_char(c))
            .last()
            .map_or(start, |(i, _)| i);
        let to = text[end..]
            .char_indices()
            .find(|&(_, c)| !is_word_char(c))
            .map_or(text.len(), |(i, _)| end + i);
        let token = &text[from..to];
        Some(Identifier {
            token,
            shape: IdentifierShape::of(token)?,
        })
    }

    /// Whether the engine's suggestions show this is a word typed in the wrong case.
    #[must_use]
    pub fn is_casing_slip(&self, suggestions: &[String]) -> bool {
        self.shape == IdentifierShape::Camel
            && min_suggestion_distance(self.token, suggestions) == Some(0)
    }
}

fn is_word_char(c: char) -> bool {
    c == '_' || c.is_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::{Identifier, IdentifierShape};

    fn shape(token: &str) -> Option<IdentifierShape> {
        IdentifierShape::of(token)
    }

    #[test]
    fn snake_case_needs_an_internal_underscore() {
        for token in [
            "foo_bar",
            "parse_json_blob",
            "MAX_RETRY_COUNT",
            "x86_64",
            "_foo_bar",
        ] {
            assert_eq!(shape(token), Some(IdentifierShape::Snake), "{token}");
        }
        for token in ["_emphasis_", "__init__", "_", "__", "1_000"] {
            assert_eq!(shape(token), None, "{token}");
        }
    }

    #[test]
    fn camel_case_needs_a_lower_to_upper_transition() {
        for token in [
            "fooBar",
            "getElementById",
            "GitHub",
            "iPhone",
            "XMLHttpRequest",
        ] {
            assert_eq!(shape(token), Some(IdentifierShape::Camel), "{token}");
        }
        for token in ["Hello", "NASA", "APIs", "URLs", "THe", "word", "HTTPServer"] {
            assert_eq!(shape(token), None, "{token}");
        }
    }

    #[test]
    fn a_digit_starts_a_hump_only_after_a_lowercase_letter() {
        assert_eq!(shape("base64Encode"), Some(IdentifierShape::Camel));
        assert_eq!(shape("3D"), None);
        assert_eq!(shape("H2O"), None);
    }

    #[test]
    fn shapes_are_unicode_aware() {
        assert_eq!(shape("größeWert"), Some(IdentifierShape::Camel));
        assert_eq!(shape("über_alles"), Some(IdentifierShape::Snake));
    }

    #[test]
    fn a_span_inside_snake_case_widens_to_the_whole_token() {
        let text = "Call parse_json_blob first.";
        let start = text.find("json").unwrap();
        let ident = Identifier::enclosing(text, start, start + 4).unwrap();
        assert_eq!(ident.token, "parse_json_blob");
        assert_eq!(ident.shape, IdentifierShape::Snake);
    }

    #[test]
    fn a_whole_camel_case_span_is_its_own_token() {
        let text = "Use getElementById.";
        let ident = Identifier::enclosing(text, 4, 18).unwrap();
        assert_eq!(ident.token, "getElementById");
    }

    #[test]
    fn spans_reaching_past_the_token_are_not_judged() {
        let text = "a fooBar here";
        assert_eq!(Identifier::enclosing(text, 0, 8), None);
        assert_eq!(Identifier::enclosing(text, 2, 9), None);
    }

    #[test]
    fn ordinary_words_and_bad_offsets_are_not_identifiers() {
        let text = "plain teh words ü";
        assert_eq!(Identifier::enclosing(text, 6, 9), None);
        assert_eq!(Identifier::enclosing(text, 3, 3), None);
        assert_eq!(Identifier::enclosing(text, 0, 99), None);
        let umlaut = text.find('ü').unwrap();
        assert_eq!(Identifier::enclosing(text, umlaut + 1, umlaut + 2), None);
    }

    #[test]
    fn a_suggestion_in_another_case_marks_a_casing_slip() {
        let slip = Identifier::enclosing("tHe", 0, 3).unwrap();
        assert!(slip.is_casing_slip(&["the".into()]));
        assert!(!slip.is_casing_slip(&["they".into()]));
        assert!(!slip.is_casing_slip(&[]));
    }

    #[test]
    fn snake_case_is_never_a_casing_slip() {
        let ident = Identifier::enclosing("foo_bar", 0, 7).unwrap();
        assert!(!ident.is_casing_slip(&["FOO_BAR".into()]));
    }
}
