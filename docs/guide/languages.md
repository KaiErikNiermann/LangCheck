# Language Support

## Supported File Types

Language Check extracts prose from these file formats using tree-sitter parsers:

| Format   | Language ID | Parser              |
|----------|-------------|---------------------|
| Markdown | `markdown`  | tree-sitter-markdown |
| HTML     | `html`      | tree-sitter-html     |
| LaTeX    | `latex`     | tree-sitter-latex    |

Additional formats can be supported via [SLS schemas](../advanced/plugins.md) or [external providers](../advanced/providers.md).

## Checking Languages

The spell-check and grammar-check language is separate from the file type. Click the language indicator in the VS Code status bar to switch:

- **EN-US** — American English
- **EN-GB** — British English
- **DE-DE** — German
- **FR** — French
- **ES** — Spanish

Language detection can also be automatic via the [whatlang](https://crates.io/crates/whatlang) crate when no explicit language is set.
