use anyhow::{Result, anyhow};
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator};

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
}

impl ProseExtractor {
    pub fn new(language: Language) -> Result<Self> {
        let mut parser = Parser::new();
        parser.set_language(&language)?;
        Ok(Self { parser, language })
    }

    pub fn extract(&mut self, text: &str, lang_id: &str) -> Result<Vec<ProseRange>> {
        let tree = self
            .parser
            .parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;

        let query_str = match lang_id {
            "markdown" => "(paragraph) @prose (atx_heading) @prose",
            "html" | "latex" => "(text) @prose",
            _ => "(paragraph) @prose",
        };

        let query = Query::new(&self.language, query_str)
            .map_err(|e| anyhow!("Failed to create query for {lang_id}: {e}"))?;

        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&query, tree.root_node(), text.as_bytes());

        let mut ranges = Vec::new();
        while let Some(m) = matches.next() {
            for capture in m.captures {
                ranges.push(ProseRange {
                    start_byte: capture.node.start_byte(),
                    end_byte: capture.node.end_byte(),
                });
            }
        }

        Ok(ranges)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_extraction() -> Result<()> {
        let language: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text =
            "# Header\n\nThis is a paragraph.\n\n```rust\nfn main() {}\n```\n\nAnother paragraph.";
        let ranges = extractor.extract(text, "markdown")?;

        // We expect "Header", "This is a paragraph.", and "Another paragraph."
        // The code block should be ignored.
        assert!(ranges.len() >= 3);

        let extracted_texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        // The tree-sitter-md grammar includes trailing newlines in node ranges
        assert!(extracted_texts.iter().any(|t| t.contains("Header")));
        assert!(extracted_texts.iter().any(|t| t.contains("This is a paragraph")));
        assert!(extracted_texts.iter().any(|t| t.contains("Another paragraph")));

        Ok(())
    }
}
