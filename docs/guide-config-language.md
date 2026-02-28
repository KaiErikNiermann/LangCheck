# Adding Language Support via Config (No Code Required)

lang-check supports two no-code ways to recognize additional file formats:

- map a new extension onto an existing built-in language, or
- define a **Simplified Language Schema (SLS)** in YAML for a format that does
  not have a built-in tree-sitter extractor.

This page focuses on the SLS workflow.

## When to use an SLS schema

Use an SLS schema when:

- the format is mostly line-oriented markup or config,
- you can describe prose lines with regular expressions,
- code blocks or metadata can be skipped with simple line or block rules, and
- you do not want to write Rust or add a tree-sitter grammar.

Common examples include AsciiDoc, TOML-with-comments, INI-like formats, and
project-specific note formats.

## Where schema files live

Create schema files in your workspace at:

```text
.langcheck/schemas/
```

lang-check loads every `.yaml` and `.yml` file from that directory in both the
CLI and the language-check server.

Example layout:

```text
my-project/
  .languagecheck.yaml
  .langcheck/
    schemas/
      asciidoc.yaml
      toml-notes.yml
```

## Schema file format

Each schema file is a YAML object with these fields:

- `name`: a human-readable language ID for the schema.
- `extensions`: file extensions handled by the schema, without leading dots.
- `prose_patterns`: regex rules for lines that count as prose.
- `skip_patterns`: regex rules for lines that should be ignored.
- `skip_blocks`: start/end regex pairs for multi-line blocks that should be
  ignored entirely.

Minimal shape:

```yaml
name: my-format
extensions:
  - myfmt
prose_patterns:
  - pattern: "..."
skip_patterns:
  - pattern: "..."
skip_blocks:
  - start: "..."
    end: "..."
```

### `prose_patterns`

`prose_patterns` is a list of line-level regexes. A non-empty line is treated
as prose only if it matches at least one pattern.

If you leave `prose_patterns` empty, every non-empty line is treated as prose
unless it is excluded by `skip_patterns` or `skip_blocks`.

### `skip_patterns`

`skip_patterns` is a list of line-level regexes. If a line matches any of them,
that line is excluded from checking.

Use this for:

- headings,
- directive lines,
- comments,
- key/value assignments,
- delimiter lines.

### `skip_blocks`

`skip_blocks` defines multi-line regions to exclude. Each entry has:

- `start`: regex for the opening line,
- `end`: regex for the closing line.

Once a `start` line matches, lang-check skips that line, everything inside the
block, and the closing delimiter line.

Use this for:

- fenced code blocks,
- literal blocks,
- embedded scripts,
- heredoc-style regions.

## Worked Example: AsciiDoc

This schema treats normal text as prose, skips headings, and ignores fenced
listing blocks delimited by `----`.

Create `.langcheck/schemas/asciidoc.yaml` in your workspace with:

```yaml
name: asciidoc
extensions:
  - adoc
  - asciidoc
prose_patterns: []
skip_patterns:
  - pattern: "^=+\\s"
skip_blocks:
  - start: "^----\\s*$"
    end: "^----\\s*$"
```

Sample file:

```text
= Document Title

This is an test.

----
This is an test in code.
----
```

With the schema above:

- the heading line is skipped by `skip_patterns`,
- the fenced block is skipped by `skip_blocks`,
- `This is an test.` is treated as prose and checked.

Verify it with:

```bash
language-check check path/to/file.adoc
```

## Worked Example: TOML Notes

For a TOML-like file where only free-form comment lines should be checked:

```yaml
name: toml-notes
extensions:
  - toml
prose_patterns: []
skip_patterns:
  - pattern: "^\\s*\\["
  - pattern: "^\\s*\\w+\\s*="
skip_blocks: []
```

This will ignore tables and assignments while still checking plain text lines
that do not match those patterns.

## Built-in languages still win

SLS schemas are a fallback only. If a file extension already has a built-in
tree-sitter extractor, lang-check keeps using the built-in extractor for that
extension.

That means:

- a custom `.rst` schema will not replace the built-in reStructuredText
  extractor,
- a custom `.md` schema will not replace Markdown,
- schemas are primarily for new extensions that do not already have first-class
  support.

## When to use extension aliases instead

If the new format is truly the same as an existing built-in format, a simple
extension alias in `.languagecheck.yaml` is usually better:

```yaml
languages:
  extensions:
    markdown:
      - mdx
```

That reuses the target language's full tree-sitter extractor instead of the
regex-based SLS fallback.

## Limitations

- SLS extraction is regex-based, not AST-aware.
- Matching is line-oriented; nested syntax is not understood.
- Block skipping depends entirely on your `start`/`end` patterns.
- If a format needs structural parsing, use the plugin workflow instead.

For a dedicated tree-sitter-based language integration, see
[guide-plugin-language.md](guide-plugin-language.md).
