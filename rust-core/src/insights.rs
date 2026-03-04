use serde::{Deserialize, Serialize};

use crate::prose::ProseRange;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProseInsights {
    pub word_count: usize,
    pub sentence_count: usize,
    pub character_count: usize,
    pub reading_level: f32, // ARI score
}

/// Check if position `i` in `bytes` is a quote or closing paren followed by
/// whitespace or end-of-string (sentence-terminating wrapper character).
fn is_quote_or_paren(bytes: &[u8], i: usize, len: usize, right_dquote: [u8; 3]) -> bool {
    if matches!(bytes[i], b'"' | b'\'' | b')') {
        return i + 1 >= len || bytes[i + 1].is_ascii_whitespace();
    }
    if i + 2 < len && bytes[i..i + 3] == right_dquote {
        return i + 3 >= len || bytes[i + 3].is_ascii_whitespace();
    }
    false
}

/// Count sentences by scanning for sentence-ending punctuation followed by
/// whitespace or end-of-string. Avoids false splits on abbreviations like
/// "Dr.", "e.g.", decimal numbers, and ellipses.
fn count_sentences(text: &str) -> usize {
    /// UTF-8 encoding of U+201D RIGHT DOUBLE QUOTATION MARK (3 bytes).
    const RIGHT_DQUOTE: [u8; 3] = [0xE2, 0x80, 0x9D];

    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut count: usize = 0;
    let mut i = 0;

    while i < len {
        if !matches!(bytes[i], b'.' | b'!' | b'?') {
            i += 1;
            continue;
        }

        // Skip consecutive punctuation (e.g. "..." or "?!")
        while i + 1 < len && matches!(bytes[i + 1], b'.' | b'!' | b'?') {
            i += 1;
        }

        let next = i + 1;
        if next >= len {
            count += 1;
        } else if bytes[next].is_ascii_whitespace() {
            // Skip single uppercase letter before punctuation (abbreviation/initial)
            let is_initial = i >= 1
                && bytes[i - 1].is_ascii_uppercase()
                && (i < 2 || bytes[i - 2].is_ascii_whitespace());
            if !is_initial {
                count += 1;
            }
        } else if is_quote_or_paren(bytes, next, len, RIGHT_DQUOTE) {
            count += 1;
        }

        i += 1;
    }

    if count == 0 && bytes.iter().any(u8::is_ascii_alphanumeric) {
        count = 1;
    }
    count
}

/// Count words — only tokens that contain at least one alphanumeric character.
fn count_words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count()
}

/// Count characters — only alphanumeric + common prose punctuation.
/// Excludes markup characters like {, }, [, ], <, >, \, #, *, etc.
fn count_characters(text: &str) -> usize {
    text.chars()
        .filter(|c| {
            c.is_alphanumeric() || matches!(c, '\'' | '\u{2019}' | '-' | '\u{2013}' | '\u{2014}')
        })
        .count()
}

#[allow(clippy::cast_precision_loss)]
fn compute_ari(character_count: usize, word_count: usize, sentence_count: usize) -> f32 {
    if word_count > 0 && sentence_count > 0 {
        4.71f32.mul_add(
            character_count as f32 / word_count as f32,
            0.5f32.mul_add(word_count as f32 / sentence_count as f32, -21.43),
        )
    } else {
        0.0
    }
}

impl ProseInsights {
    /// Analyze extracted prose text (already stripped of markup).
    #[must_use]
    pub fn analyze(text: &str) -> Self {
        let character_count = count_characters(text);
        let word_count = count_words(text);
        let sentence_count = count_sentences(text);
        let reading_level = compute_ari(character_count, word_count, sentence_count);

        Self {
            word_count,
            sentence_count,
            character_count,
            reading_level,
        }
    }

    /// Analyze only the extracted prose ranges from a document, ignoring markup.
    #[must_use]
    pub fn analyze_ranges(full_text: &str, ranges: &[ProseRange]) -> Self {
        let mut total_characters = 0;
        let mut total_words = 0;
        let mut total_sentences = 0;

        for range in ranges {
            let prose = range.extract_text(full_text);
            total_characters += count_characters(&prose);
            total_words += count_words(&prose);
            total_sentences += count_sentences(&prose);
        }

        let reading_level = compute_ari(total_characters, total_words, total_sentences);

        Self {
            word_count: total_words,
            sentence_count: total_sentences,
            character_count: total_characters,
            reading_level,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text() {
        let insights = ProseInsights::analyze("");
        assert_eq!(insights.word_count, 0);
        assert_eq!(insights.sentence_count, 0);
        assert_eq!(insights.character_count, 0);
        assert_eq!(insights.reading_level, 0.0);
    }

    #[test]
    fn single_sentence() {
        let insights = ProseInsights::analyze("Hello world.");
        assert_eq!(insights.word_count, 2);
        assert_eq!(insights.sentence_count, 1);
        assert_eq!(insights.character_count, 10);
    }

    #[test]
    fn multiple_sentences() {
        let insights = ProseInsights::analyze("First sentence. Second sentence. Third one!");
        assert_eq!(insights.word_count, 6);
        assert_eq!(insights.sentence_count, 3);
    }

    #[test]
    fn reading_level_simple_text() {
        let text = "The cat sat. The dog ran. A bird flew.";
        let insights = ProseInsights::analyze(text);
        assert!(insights.reading_level < 10.0);
    }

    #[test]
    fn reading_level_complex_text() {
        let text = "Notwithstanding the aforementioned constitutional provisions, \
                    the jurisprudential interpretation necessitates comprehensive \
                    deliberation regarding substantive procedural requirements.";
        let insights = ProseInsights::analyze(text);
        assert!(insights.reading_level > 10.0);
    }

    #[test]
    fn character_count_excludes_whitespace() {
        let insights = ProseInsights::analyze("a b c");
        assert_eq!(insights.character_count, 3);
    }

    #[test]
    fn question_marks_count_as_sentences() {
        let insights = ProseInsights::analyze("Is this a question? Yes it is.");
        assert_eq!(insights.sentence_count, 2);
    }

    #[test]
    fn ellipses_not_counted_as_multiple_sentences() {
        let insights = ProseInsights::analyze("Wait for it... and there it is.");
        assert_eq!(insights.sentence_count, 2);
    }

    #[test]
    fn initials_not_split() {
        // "J." is a single-letter initial — should not create a sentence boundary.
        let insights = ProseInsights::analyze("I met J. Smith at the office.");
        assert_eq!(insights.sentence_count, 1);
    }

    #[test]
    fn markup_characters_excluded_from_count() {
        // Simulate leftover markup chars in extracted prose
        let insights = ProseInsights::analyze("Hello [world](http://example.com).");
        // Only alphanumeric + prose punctuation counted:
        // "Hello" (5) + "world" (5) + "http" (4) + "example" (7) + "com" (3) = 24
        // Brackets, parens, slashes, colons, dots in URL excluded
        assert!(insights.character_count < 30);
    }

    #[test]
    fn text_without_terminal_punctuation_counts_as_one_sentence() {
        let insights = ProseInsights::analyze("A sentence without ending punctuation");
        assert_eq!(insights.sentence_count, 1);
    }

    #[test]
    fn analyze_ranges_uses_prose_only() {
        // Document with markup around prose
        let doc = "# Heading\n\nThe cat sat on the mat. The dog ran home.\n\n```code block```\n";
        let ranges = vec![ProseRange {
            start_byte: 12, // "The cat sat on the mat. The dog ran home.\n"
            end_byte: 54,
            exclusions: vec![],
        }];
        let from_ranges = ProseInsights::analyze_ranges(doc, &ranges);
        let prose_only = ProseInsights::analyze(&doc[12..54]);
        assert_eq!(from_ranges.word_count, prose_only.word_count);
        assert_eq!(from_ranges.sentence_count, prose_only.sentence_count);
        assert_eq!(from_ranges.character_count, prose_only.character_count);
    }
}
