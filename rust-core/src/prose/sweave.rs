use tree_sitter::Node;

use super::ProseRange;
use super::latex;

/// Preprocess Sweave text by replacing R code chunks with spaces.
///
/// R code chunks start with a line matching `<<...>>=` and end with a line
/// matching `@` on its own (with optional trailing whitespace). Every byte in
/// the chunk (including the delimiter lines) is replaced with a space to
/// preserve byte offsets.
fn preprocess(text: &str) -> String {
    let mut result = text.to_string();
    // SAFETY: we only replace valid UTF-8 bytes with ASCII spaces.
    let bytes = unsafe { result.as_bytes_mut() };
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // We only match `<<` at the start of a line.
        let at_line_start = i == 0 || bytes[i - 1] == b'\n';
        if at_line_start && i + 1 < len && bytes[i] == b'<' && bytes[i + 1] == b'<' {
            // Scan forward to find `>>=` followed by optional whitespace then newline/EOF.
            let line_end = memchr_newline(bytes, i);
            let line = &bytes[i..line_end];

            if is_chunk_start(line) {
                let chunk_start = i;
                // Move past this line
                i = line_end;
                if i < len && bytes[i] == b'\n' {
                    i += 1;
                }

                // Scan for terminating `@` line
                loop {
                    if i >= len {
                        // Unterminated chunk: blank to end of file
                        break;
                    }
                    let next_line_end = memchr_newline(bytes, i);
                    let next_line = &bytes[i..next_line_end];
                    let is_end = is_chunk_end(next_line);

                    if is_end {
                        // Include the `@` line in the blanked region
                        i = next_line_end;
                        if i < len && bytes[i] == b'\n' {
                            i += 1;
                        }
                        break;
                    }

                    i = next_line_end;
                    if i < len && bytes[i] == b'\n' {
                        i += 1;
                    }
                }

                // Blank out everything from chunk_start to current position,
                // but preserve newlines so tree-sitter line tracking stays sane.
                for b in &mut bytes[chunk_start..i] {
                    if *b != b'\n' {
                        *b = b' ';
                    }
                }

                continue;
            }
        }

        i += 1;
    }

    result
}

/// Find the index of the next newline (or end-of-slice) starting from `start`.
fn memchr_newline(bytes: &[u8], start: usize) -> usize {
    let mut j = start;
    while j < bytes.len() && bytes[j] != b'\n' {
        j += 1;
    }
    j
}

/// Check if a line (without trailing newline) is a chunk start: `<<...>>=` with
/// optional trailing whitespace.
fn is_chunk_start(line: &[u8]) -> bool {
    // Must start with `<<`
    if line.len() < 4 || line[0] != b'<' || line[1] != b'<' {
        return false;
    }
    // Find `>>=`
    let mut i = 2;
    while i + 2 < line.len() {
        if line[i] == b'>' && line[i + 1] == b'>' && line[i + 2] == b'=' {
            // Rest after `>>=` must be only whitespace
            let rest = &line[i + 3..];
            return rest.iter().all(|&b| b == b' ' || b == b'\t' || b == b'\r');
        }
        i += 1;
    }
    // Check if `>>=` is at the very end
    if line.len() >= 3 {
        let tail = &line[line.len() - 3..];
        if tail == b">>=" {
            return true;
        }
    }
    false
}

/// Check if a line (without trailing newline) is a chunk end: `@` followed by
/// only whitespace.
fn is_chunk_end(line: &[u8]) -> bool {
    if line.is_empty() || line[0] != b'@' {
        return false;
    }
    line[1..]
        .iter()
        .all(|&b| b == b' ' || b == b'\t' || b == b'\r')
}

/// Extract prose ranges from a Sweave (.Rnw) document.
///
/// Preprocesses the text to blank out R code chunks, then delegates to the
/// LaTeX prose extractor. Since preprocessing preserves byte offsets (replacing
/// code bytes with spaces and keeping newlines), the returned ranges map
/// directly back to the original document.
pub(crate) fn extract(text: &str, root: Node, extra_skip_envs: &[String]) -> Vec<ProseRange> {
    let preprocessed = preprocess(text);

    // Re-parse the preprocessed text with the same LaTeX grammar so that the
    // tree-sitter AST reflects the blanked-out regions.
    let mut parser = tree_sitter::Parser::new();
    let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
    parser.set_language(&language).expect("latex grammar");
    let tree = parser
        .parse(&preprocessed, None)
        .expect("parse preprocessed sweave text");
    let new_root = tree.root_node();

    // Use the original root parameter is ignored; we parse fresh.
    let _ = root;

    latex::extract(&preprocessed, new_root, extra_skip_envs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prose::ProseExtractor;
    use anyhow::Result;

    #[test]
    fn test_preprocess_blanks_r_chunks() {
        let text = "before\n<<setup>>=\nlibrary(x)\n@\nafter\n";
        let result = preprocess(text);
        assert!(result.contains("before"));
        assert!(result.contains("after"));
        assert!(!result.contains("library"));
        assert!(!result.contains("<<setup>>="));
        assert_eq!(text.len(), result.len(), "byte length must be preserved");
    }

    #[test]
    fn test_preprocess_multiple_chunks() {
        let text = "text1\n<<a>>=\ncode1\n@\ntext2\n<<b>>=\ncode2\n@\ntext3\n";
        let result = preprocess(text);
        assert!(result.contains("text1"));
        assert!(result.contains("text2"));
        assert!(result.contains("text3"));
        assert!(!result.contains("code1"));
        assert!(!result.contains("code2"));
    }

    #[test]
    fn test_preprocess_chunk_with_options() {
        let text = "start\n<<my-chunk, echo=FALSE, fig=TRUE>>=\nplot(x)\n@\nend\n";
        let result = preprocess(text);
        assert!(result.contains("start"));
        assert!(result.contains("end"));
        assert!(!result.contains("plot"));
        assert!(!result.contains("echo=FALSE"));
    }

    #[test]
    fn test_preprocess_preserves_newlines() {
        let text = "line1\n<<a>>=\ncode\n@\nline2\n";
        let result = preprocess(text);
        // Count newlines in original and result
        let orig_newlines = text.chars().filter(|&c| c == '\n').count();
        let result_newlines = result.chars().filter(|&c| c == '\n').count();
        assert_eq!(orig_newlines, result_newlines, "newline count must match");
    }

    #[test]
    fn test_is_chunk_start() {
        assert!(is_chunk_start(b"<<>>="));
        assert!(is_chunk_start(b"<<setup>>="));
        assert!(is_chunk_start(b"<<my-chunk, echo=FALSE>>="));
        assert!(is_chunk_start(b"<<a>>=  "));
        assert!(!is_chunk_start(b"<< not closed"));
        assert!(!is_chunk_start(b"regular text"));
        assert!(!is_chunk_start(b""));
    }

    #[test]
    fn test_is_chunk_end() {
        assert!(is_chunk_end(b"@"));
        assert!(is_chunk_end(b"@  "));
        assert!(is_chunk_end(b"@\t"));
        assert!(!is_chunk_end(b"@ text after"));
        assert!(!is_chunk_end(b"not @"));
        assert!(!is_chunk_end(b""));
    }

    #[test]
    fn test_preprocess_no_chunks() {
        let text = "Just regular LaTeX content.\n\\section{Hello}\nSome text.\n";
        let result = preprocess(text);
        assert_eq!(text, result, "text without R chunks should be unchanged");
    }

    fn sweave_extractor() -> Result<ProseExtractor> {
        let language = crate::languages::resolve_ts_language("sweave");
        ProseExtractor::new(language)
    }

    #[test]
    fn test_sweave_basic_extraction() -> Result<()> {
        let mut extractor = sweave_extractor()?;

        let text = r"\documentclass{article}
\begin{document}

This is a paragraph in a Sweave document.

<<setup, echo=FALSE>>=
library(ggplot2)
x <- rnorm(100)
@

Another paragraph after the R chunk.

\end{document}
";
        let ranges = extractor.extract(text, "sweave", &[])?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted
                .iter()
                .any(|t| t.contains("paragraph in a Sweave")),
            "Should extract prose text before R chunk, got: {extracted:?}"
        );
        assert!(
            extracted
                .iter()
                .any(|t| t.contains("Another paragraph after")),
            "Should extract prose text after R chunk, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_sweave_r_chunk_excluded() -> Result<()> {
        let mut extractor = sweave_extractor()?;

        let text = r"\documentclass{article}
\begin{document}

Some prose before code.

<<my-chunk, fig=TRUE>>=
plot(1:10)
summary(lm(y ~ x))
@

Some prose after code.

\end{document}
";
        let ranges = extractor.extract(text, "sweave", &[])?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            !all_prose.contains("plot(1:10)"),
            "R code should NOT appear in prose, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("summary(lm"),
            "R code should NOT appear in prose, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("prose before code"),
            "Prose before R chunk should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("prose after code"),
            "Prose after R chunk should be extracted, got: {all_prose:?}"
        );

        Ok(())
    }
}
