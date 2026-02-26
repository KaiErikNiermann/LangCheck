use tree_sitter::{Parser, Language, Query, QueryCursor};
use anyhow::{Result, anyhow};

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
}

impl ProseExtractor {
    pub fn new(language: Language) -> Result<Self> {
        let mut parser = Parser::new();
        parser.set_language(language)?;
        Ok(Self { parser, language })
    }

    pub fn extract(&mut self, text: &str) -> Result<Vec<ProseRange>> {
        let tree = self.parser.parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;
        
        // Example query for Markdown (this might need adjustment based on the grammar)
        let query_str = "(paragraph) @prose (atx_heading) @prose";
        let query = Query::new(self.language, query_str)
            .map_err(|e| anyhow!("Failed to create query: {}", e))?;
        
        let mut cursor = QueryCursor::new();
        let matches = cursor.matches(&query, tree.root_node(), |node| {
            &text.as_bytes()[node.byte_range()]
        });
        
        let mut ranges = Vec::new();
        for m in matches {
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

#[derive(Debug)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
}
