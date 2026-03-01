# Language Support

## Supported File Types

Language Check extracts prose from these file formats using tree-sitter parsers:

| Format              | Language ID | Extensions                | Parser / Strategy                        |
|---------------------|-------------|---------------------------|------------------------------------------|
| Markdown            | `markdown`  | `.md`, `.markdown`        | tree-sitter-markdown                     |
| MDX                 | (alias)     | `.mdx`                    | Treated as Markdown                      |
| HTML                | `html`      | `.html`, `.htm`           | tree-sitter-html                         |
| XHTML               | (alias)     | `.xhtml`                  | Treated as HTML                          |
| LaTeX               | `latex`     | `.tex`, `.latex`, `.ltx`  | tree-sitter-latex                        |
| R Sweave            | `sweave`    | `.Rnw`, `.rnw`            | R chunk preprocessing + tree-sitter-latex|
| reStructuredText    | `rst`       | `.rst`, `.rest`           | tree-sitter-rst                          |
| Org mode            | `org`       | `.org`                    | tree-sitter-org (vendored)               |
| BibTeX              | `bibtex`    | `.bib`                    | tree-sitter-bibtex                       |
| Forester            | `forester`  | `.tree`                   | tree-sitter-forester (vendored)          |

### Prose extraction details

Each language has a custom prose extractor that understands which parts of a document contain human-readable text:

- **Markdown / HTML** — Uses tree-sitter query patterns to select prose nodes, skipping code blocks, front matter, and inline code.
- **LaTeX** — Tree-walks the AST collecting `word` nodes from `\begin{document}` onward. Skips preamble, math environments, verbatim/minted/algorithm blocks, and structural commands (`\ref`, `\label`, `\includegraphics`, etc.). Display math (`\[...\]`) bridges into surrounding prose as an exclusion zone.
- **R Sweave** — Preprocesses R code chunks (`<<...>>=` through `@`) by blanking them with whitespace, then delegates to the LaTeX extractor.
- **reStructuredText** — Extracts `paragraph` and `title` nodes. Skips code-block, math, raw, and similar directives. Inline literals are marked as exclusion zones.
- **Org mode** — Extracts paragraph text and heading titles. Skips `#+begin_src` blocks, drawers (`:PROPERTIES:`), LaTeX environments, comments, and tables.
- **BibTeX** — Extracts prose from specific fields: `title`, `booktitle`, `abstract`, `note`, `annote`, `annotation`, `howpublished`, and `series`. Other fields (author, journal, year, etc.) are ignored. LaTeX commands inside values (e.g. `\emph{...}`) are handled via exclusion zones.
- **Forester** — Collects `text` and `escape` nodes, skipping math (`#{...}`, `##{...}`), verbatim fences, wiki links, comments, and structural commands (`\import`, `\ref`, `\def`, etc.). Display math bridges as an exclusion zone.

### Adding more file types

You can add support for extra file types without code in two ways:

- map new extensions onto existing built-in language IDs, or
- define regex-based Simplified Language Schema (SLS) YAML files in
  `.langcheck/schemas/`.

See the [Config-Only Language Guide](../guide-config-language.md) for both
workflows, including a full schema example.

```{tip}
To add support for an entirely new markup language with its own tree-sitter grammar, see the [Plugin Language Guide](../guide-plugin-language.md).
```

## Checking Languages

The spell-check and grammar-check language is separate from the file type. Click the language indicator in the VS Code status bar to switch:

- **EN-US** — American English
- **EN-GB** — British English
- **DE-DE** — German
- **FR** — French
- **ES** — Spanish

Language detection can also be automatic via the [whatlang](https://crates.io/crates/whatlang) crate when no explicit language is set.
