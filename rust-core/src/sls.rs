use anyhow::Result;
use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::path::Path;

use crate::prose::ProseRange;

pub const DEFAULT_SCHEMA_DIR: &str = ".langcheck/schemas";

/// A Simplified Language Schema definition, loaded from YAML.
///
/// Defines how to extract prose regions from a file format using regex patterns,
/// for languages that don't have tree-sitter grammars (e.g. RST, `AsciiDoc`, TOML).
#[derive(Debug, Deserialize, Clone)]
pub struct LanguageSchema {
    /// Schema name (e.g. "restructuredtext").
    pub name: String,
    /// File extensions this schema handles (e.g. [`rst`, `rest`]).
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Patterns that match lines containing prose text.
    #[serde(default)]
    pub prose_patterns: Vec<PatternRule>,
    /// Patterns that match lines to skip (comments, directives, code, etc.).
    #[serde(default)]
    pub skip_patterns: Vec<PatternRule>,
    /// Block delimiters for multi-line regions to skip entirely.
    #[serde(default)]
    pub skip_blocks: Vec<BlockRule>,
}

/// A single-line regex pattern rule.
#[derive(Debug, Deserialize, Clone)]
pub struct PatternRule {
    /// The regex pattern to match against each line.
    pub pattern: String,
}

/// A block delimiter pair for regions to skip.
#[derive(Debug, Deserialize, Clone)]
pub struct BlockRule {
    /// Regex matching the start of the block.
    pub start: String,
    /// Regex matching the end of the block.
    pub end: String,
}

/// Compiled version of a `LanguageSchema`, ready for fast matching.
#[derive(Debug)]
pub struct CompiledSchema {
    pub name: String,
    pub extensions: Vec<String>,
    prose_patterns: Vec<Regex>,
    skip_patterns: Vec<Regex>,
    skip_blocks: Vec<(Regex, Regex)>,
}

impl CompiledSchema {
    /// Compile a schema from its YAML definition.
    pub fn compile(schema: &LanguageSchema) -> Result<Self> {
        let prose_patterns: Result<Vec<_>> = schema
            .prose_patterns
            .iter()
            .map(|p| Regex::new(&p.pattern).map_err(Into::into))
            .collect();

        let skip_patterns: Result<Vec<_>> = schema
            .skip_patterns
            .iter()
            .map(|p| Regex::new(&p.pattern).map_err(Into::into))
            .collect();

        let skip_blocks: Result<Vec<_>> = schema
            .skip_blocks
            .iter()
            .map(|b| Ok((Regex::new(&b.start)?, Regex::new(&b.end)?)))
            .collect();

        Ok(Self {
            name: schema.name.clone(),
            extensions: schema.extensions.clone(),
            prose_patterns: prose_patterns?,
            skip_patterns: skip_patterns?,
            skip_blocks: skip_blocks?,
        })
    }

    /// Extract prose ranges from the given text.
    ///
    /// Strategy:
    /// 1. First, identify skip-block regions and mark them as excluded.
    /// 2. For each line, check if it matches a skip pattern (excluded).
    /// 3. For remaining lines, check if they match a prose pattern (included).
    /// 4. If no prose patterns are defined, all non-skipped lines are prose.
    /// 5. Merge adjacent prose ranges.
    #[must_use]
    pub fn extract(&self, text: &str) -> Vec<ProseRange> {
        let skip_regions = self.find_skip_blocks(text);
        let mut prose_lines: Vec<(usize, usize)> = Vec::new();

        let mut offset = 0;
        for line in text.split('\n') {
            let line_start = offset;
            let line_end = offset + line.len();
            offset = line_end + 1; // +1 for newline

            // Skip if inside a skip block
            if skip_regions
                .iter()
                .any(|(s, e)| line_start >= *s && line_start < *e)
            {
                continue;
            }

            // Skip if matches a skip pattern
            if self.skip_patterns.iter().any(|re| re.is_match(line)) {
                continue;
            }

            // Skip empty lines
            if line.trim().is_empty() {
                continue;
            }

            // If prose patterns are defined, line must match at least one
            if !self.prose_patterns.is_empty()
                && !self.prose_patterns.iter().any(|re| re.is_match(line))
            {
                continue;
            }

            prose_lines.push((line_start, line_end));
        }

        // Merge adjacent/contiguous ranges
        merge_ranges(prose_lines)
    }

    /// Find byte ranges of skip blocks in the text.
    fn find_skip_blocks(&self, text: &str) -> Vec<(usize, usize)> {
        let mut regions = Vec::new();

        for (start_re, end_re) in &self.skip_blocks {
            let lines: Vec<(usize, &str)> = text
                .split('\n')
                .scan(0usize, |offset, line| {
                    let start = *offset;
                    *offset += line.len() + 1;
                    Some((start, line))
                })
                .collect();

            let mut i = 0;
            while i < lines.len() {
                let (line_start, line) = lines[i];
                if start_re.is_match(line) {
                    // Find the matching end, starting from the NEXT line
                    let mut block_end = text.len();
                    for &(_, inner_line) in &lines[i + 1..] {
                        if end_re.is_match(inner_line) {
                            // End includes the closing delimiter line
                            let inner_end = inner_line.as_ptr() as usize - text.as_ptr() as usize
                                + inner_line.len();
                            block_end = inner_end;
                            // Skip past the end delimiter
                            i = lines
                                .iter()
                                .position(|&(s, _)| s >= block_end)
                                .unwrap_or(lines.len());
                            break;
                        }
                    }
                    regions.push((line_start, block_end));
                    continue;
                }
                i += 1;
            }
        }

        regions
    }
}

/// Merge contiguous or overlapping byte ranges into larger ones.
fn merge_ranges(mut ranges: Vec<(usize, usize)>) -> Vec<ProseRange> {
    if ranges.is_empty() {
        return Vec::new();
    }

    ranges.sort_by_key(|(s, _)| *s);
    let mut merged = Vec::new();
    let (mut cur_start, mut cur_end) = ranges[0];

    for &(start, end) in &ranges[1..] {
        // If this range is adjacent (within 1 byte for newline) or overlapping, extend
        if start <= cur_end + 2 {
            cur_end = cur_end.max(end);
        } else {
            merged.push(ProseRange {
                start_byte: cur_start,
                end_byte: cur_end,
                exclusions: vec![],
            });
            cur_start = start;
            cur_end = end;
        }
    }
    merged.push(ProseRange {
        start_byte: cur_start,
        end_byte: cur_end,
        exclusions: vec![],
    });

    merged
}

/// Registry of compiled schemas for looking up by file extension.
#[derive(Debug, Default)]
pub struct SchemaRegistry {
    schemas: Vec<CompiledSchema>,
}

impl SchemaRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Load and compile a schema from a YAML string.
    pub fn load_yaml(&mut self, yaml: &str) -> Result<()> {
        let schema: LanguageSchema = serde_yaml::from_str(yaml)?;
        let compiled = CompiledSchema::compile(&schema)?;
        self.schemas.push(compiled);
        Ok(())
    }

    /// Load and compile a schema from a YAML file.
    pub fn load_file(&mut self, path: &std::path::Path) -> Result<()> {
        let content = std::fs::read_to_string(path)?;
        self.load_yaml(&content)
    }

    /// Load all `.yaml`/`.yml` schemas from a directory.
    pub fn load_dir(&mut self, dir: &std::path::Path) -> Result<usize> {
        let mut count = 0;
        if !dir.exists() {
            return Ok(0);
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str())
                && (ext == "yaml" || ext == "yml")
            {
                self.load_file(&path)?;
                count += 1;
            }
        }
        Ok(count)
    }

    /// Load all workspace schemas from the default config directory.
    pub fn from_workspace(workspace_root: &Path) -> Result<Self> {
        let mut registry = Self::new();
        registry.load_dir(&workspace_root.join(DEFAULT_SCHEMA_DIR))?;
        Ok(registry)
    }

    /// Find a compiled schema by file extension.
    #[must_use]
    pub fn find_by_extension(&self, ext: &str) -> Option<&CompiledSchema> {
        self.schemas
            .iter()
            .find(|s| s.extensions.iter().any(|e| e == ext))
    }

    /// Number of loaded schemas.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.schemas.len()
    }

    /// Whether the registry is empty.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }

    /// Glob patterns for extensions handled only by SLS, preserving built-in precedence.
    #[must_use]
    pub fn fallback_file_patterns(&self) -> Vec<(String, String)> {
        let mut patterns = BTreeSet::new();

        for schema in &self.schemas {
            for ext in &schema.extensions {
                if crate::languages::builtin_language_for_extension(ext).is_none() {
                    patterns.insert((format!("**/*.{ext}"), schema.name.clone()));
                }
            }
        }

        patterns.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RST_SCHEMA: &str = r#"
name: restructuredtext
extensions:
  - rst
  - rest
prose_patterns:
  - pattern: "^[^\\s\\.\\:].*\\S"
skip_patterns:
  - pattern: "^\\.\\."
  - pattern: "^\\s*$"
  - pattern: "^[=\\-~`:'\"^_*+#]{3,}$"
skip_blocks:
  - start: "^::\\s*$"
    end: "^\\S"
"#;

    const TOML_SCHEMA: &str = r#"
name: toml
extensions:
  - toml
prose_patterns: []
skip_patterns:
  - pattern: "^\\s*#"
  - pattern: "^\\s*\\["
  - pattern: "^\\s*\\w+\\s*="
skip_blocks: []
"#;

    #[test]
    fn compile_rst_schema() {
        let schema: LanguageSchema = serde_yaml::from_str(RST_SCHEMA).unwrap();
        let compiled = CompiledSchema::compile(&schema).unwrap();
        assert_eq!(compiled.name, "restructuredtext");
        assert_eq!(compiled.extensions, vec!["rst", "rest"]);
    }

    #[test]
    fn rst_extract_prose() {
        let schema: LanguageSchema = serde_yaml::from_str(RST_SCHEMA).unwrap();
        let compiled = CompiledSchema::compile(&schema).unwrap();

        let text = "Title\n=====\n\nThis is a paragraph.\n\n.. note::\n\n   This is a directive.\n\nAnother paragraph here.";
        let ranges = compiled.extract(text);

        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(extracted.iter().any(|t| t.contains("This is a paragraph")));
        assert!(extracted.iter().any(|t| t.contains("Another paragraph")));
        // Directive content should be excluded via skip pattern
        assert!(!extracted.iter().any(|t| t.contains(".. note")));
    }

    #[test]
    fn toml_no_prose_patterns_means_all_non_skipped() {
        let schema: LanguageSchema = serde_yaml::from_str(TOML_SCHEMA).unwrap();
        let compiled = CompiledSchema::compile(&schema).unwrap();

        // TOML with no prose_patterns and all lines matching skip patterns
        let text = "# Comment\n[section]\nkey = \"value\"";
        let ranges = compiled.extract(text);
        // All lines match skip patterns, so no prose
        assert!(ranges.is_empty());
    }

    #[test]
    fn skip_blocks() {
        let yaml = r#"
name: test
extensions: [test]
prose_patterns: []
skip_patterns: []
skip_blocks:
  - start: "^```"
    end: "^```"
"#;
        let schema: LanguageSchema = serde_yaml::from_str(yaml).unwrap();
        let compiled = CompiledSchema::compile(&schema).unwrap();

        let text = "Prose line one\n```\ncode here\nmore code\n```\nProse line two";
        let ranges = compiled.extract(text);

        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(extracted.iter().any(|t| t.contains("Prose line one")));
        assert!(extracted.iter().any(|t| t.contains("Prose line two")));
        assert!(!extracted.iter().any(|t| t.contains("code here")));
    }

    #[test]
    fn schema_registry_lookup() {
        let mut registry = SchemaRegistry::new();
        registry.load_yaml(RST_SCHEMA).unwrap();
        registry.load_yaml(TOML_SCHEMA).unwrap();
        assert_eq!(registry.len(), 2);

        let rst = registry.find_by_extension("rst");
        assert!(rst.is_some());
        assert_eq!(rst.unwrap().name, "restructuredtext");

        let toml = registry.find_by_extension("toml");
        assert!(toml.is_some());
        assert_eq!(toml.unwrap().name, "toml");

        assert!(registry.find_by_extension("py").is_none());
    }

    #[test]
    fn merge_adjacent_ranges() {
        let ranges = vec![(0, 5), (6, 10), (11, 15)];
        let merged = merge_ranges(ranges);
        // All within 2 bytes of each other, should merge to one
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_byte, 0);
        assert_eq!(merged[0].end_byte, 15);
    }

    #[test]
    fn no_merge_for_distant_ranges() {
        let ranges = vec![(0, 5), (20, 25)];
        let merged = merge_ranges(ranges);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn empty_text() {
        let schema: LanguageSchema = serde_yaml::from_str(RST_SCHEMA).unwrap();
        let compiled = CompiledSchema::compile(&schema).unwrap();
        let ranges = compiled.extract("");
        assert!(ranges.is_empty());
    }

    #[test]
    fn invalid_regex_returns_error() {
        let yaml = r#"
name: bad
extensions: [bad]
prose_patterns:
  - pattern: "[invalid"
"#;
        let schema: LanguageSchema = serde_yaml::from_str(yaml).unwrap();
        assert!(CompiledSchema::compile(&schema).is_err());
    }

    #[test]
    fn fallback_file_patterns_skip_builtins() {
        let mut registry = SchemaRegistry::new();
        registry.load_yaml(RST_SCHEMA).unwrap();
        registry
            .load_yaml(
                r#"
name: asciidoc
extensions: [adoc, asciidoc]
prose_patterns: []
skip_patterns: []
skip_blocks: []
"#,
            )
            .unwrap();

        let patterns = registry.fallback_file_patterns();

        assert!(!patterns.iter().any(|(pattern, _)| pattern == "**/*.rst"));
        assert!(
            patterns
                .iter()
                .any(|(pattern, lang)| pattern == "**/*.adoc" && lang == "asciidoc")
        );
        assert!(
            patterns
                .iter()
                .any(|(pattern, lang)| pattern == "**/*.asciidoc" && lang == "asciidoc")
        );
    }
}
