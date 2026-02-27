use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProseInsights {
    pub word_count: usize,
    pub sentence_count: usize,
    pub character_count: usize,
    pub reading_level: f32, // ARI score
}

impl ProseInsights {
    #[must_use]
    #[allow(clippy::cast_precision_loss)]
    pub fn analyze(text: &str) -> Self {
        let character_count = text.chars().filter(|c| !c.is_whitespace()).count();
        let word_count = text.split_whitespace().count();

        // Very basic sentence detection
        let sentence_count = text
            .split(['.', '!', '?'])
            .filter(|s| !s.trim().is_empty())
            .count();

        let reading_level = if word_count > 0 && sentence_count > 0 {
            4.71f32.mul_add(
                character_count as f32 / word_count as f32,
                0.5f32.mul_add(word_count as f32 / sentence_count as f32, -21.43),
            )
        } else {
            0.0
        };

        Self {
            word_count,
            sentence_count,
            character_count,
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
        // character_count includes punctuation, excludes whitespace only
        assert_eq!(insights.character_count, 11);
    }

    #[test]
    fn multiple_sentences() {
        let insights = ProseInsights::analyze("First sentence. Second sentence. Third one!");
        // split_whitespace counts all whitespace-delimited tokens
        assert_eq!(insights.word_count, 6);
        assert_eq!(insights.sentence_count, 3);
    }

    #[test]
    fn reading_level_simple_text() {
        let text = "The cat sat. The dog ran. A bird flew.";
        let insights = ProseInsights::analyze(text);
        // Simple text should have a low reading level
        assert!(insights.reading_level < 10.0);
    }

    #[test]
    fn reading_level_complex_text() {
        let text = "Notwithstanding the aforementioned constitutional provisions, \
                    the jurisprudential interpretation necessitates comprehensive \
                    deliberation regarding substantive procedural requirements.";
        let insights = ProseInsights::analyze(text);
        // Complex text with long words should have a higher reading level
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
}
