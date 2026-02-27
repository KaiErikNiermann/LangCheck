use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProseInsights {
    pub word_count: usize,
    pub sentence_count: usize,
    pub character_count: usize,
    pub reading_level: f32, // ARI score
}

impl ProseInsights {
    pub fn analyze(text: &str) -> Self {
        let character_count = text.chars().filter(|c| !c.is_whitespace()).count();
        let words: Vec<&str> = text.split_whitespace().collect();
        let word_count = words.len();
        
        // Very basic sentence detection
        let sentence_count = text.split(|c| c == '.' || c == '!' || c == '?')
            .filter(|s| !s.trim().is_empty())
            .count();
        
        let reading_level = if word_count > 0 && sentence_count > 0 {
            4.71 * (character_count as f32 / word_count as f32) + 0.5 * (word_count as f32 / sentence_count as f32) - 21.43
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
