use anyhow::{Result, anyhow};
use tree_sitter::{Language, Node, Query, QueryCursor, StreamingIterator};

use super::ProseRange;

/// Extract prose ranges using a tree-sitter query.
///
/// This is the generic extraction path for languages where prose regions
/// correspond directly to named AST nodes (paragraphs, headings, text nodes).
pub(crate) fn extract(
    text: &str,
    root: Node,
    language: &Language,
    lang_id: &str,
) -> Result<Vec<ProseRange>> {
    let query_str = match lang_id {
        "markdown" => "(paragraph) @prose (atx_heading) @prose",
        "html" => "(text) @prose",
        _ => "(paragraph) @prose",
    };

    let query = Query::new(language, query_str)
        .map_err(|e| anyhow!("Failed to create query for {lang_id}: {e}"))?;

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, root, text.as_bytes());

    let mut ranges = Vec::new();
    while let Some(m) = matches.next() {
        for capture in m.captures {
            ranges.push(ProseRange {
                start_byte: capture.node.start_byte(),
                end_byte: capture.node.end_byte(),
                exclusions: vec![],
            });
        }
    }

    Ok(ranges)
}
