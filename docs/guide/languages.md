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
| Typst               | `typst`     | `.typ`                    | tree-sitter-typst (vendored)             |
| Forester            | `forester`  | `.tree`                   | tree-sitter-forester (vendored)          |

### Prose extraction details

Each language has a custom prose extractor that understands which parts of a document contain human-readable text.

An extractor answers two questions. The first is which AST nodes carry prose, which is a walk over the tree. The second is what sits in the *gap* between two of those nodes — the markup that decides whether the words on either side belong to one prose block, and which bytes the checker must never see. A language describes its gap syntax once, as a single function that recognizes one token at a byte offset, and both answers are derived from it; see [Adding Language Support via the Plugin Path](../guide-plugin-language.md) for how to write one. Markdown and HTML take a different path entirely, selecting prose nodes with a tree-sitter query and no gap analysis at all.

- **Markdown / HTML** — Uses tree-sitter query patterns to select prose nodes: paragraphs, headings and table cells in Markdown, text nodes in HTML. Fenced code blocks, front matter and `<script>`/`<style>` bodies are skipped. A Markdown block is handed to the checker whole, so inline code spans and link URLs are skipped by the engine's own Markdown parser rather than at extraction.
- **LaTeX** — Tree-walks the AST collecting `word` nodes from `\begin{document}` onward. Skips preamble, math environments, verbatim/minted/algorithm blocks, and structural commands (`\ref`, `\label`, `\includegraphics`, etc.). The delimiter-delimited argument of `\verb|...|`, `\verb*|...|`, `\lstinline!...!` and `\mintinline{lang}|...|` is excluded too, although the grammar leaves it outside the command node. Display math (`\[...\]`) bridges into surrounding prose as an exclusion zone.
- **R Sweave** — Preprocesses R code chunks (`<<...>>=` through `@`) by blanking them with whitespace, then delegates to the LaTeX extractor.
- **reStructuredText** — Extracts `paragraph` and `title` nodes, with inline literals as exclusion zones. A directive is split by role: its argument is a path or language (except on `csv-table`, `admonition` and friends, where it is the rendered title), its `:caption:` and `:alt:` options are prose, and its body is prose unless the type is code or data (`code-block`, `math`, `raw`, `toctree`, …). Because tree-sitter-rst leaves a directive body unparsed, the body is recovered from the raw lines: an explicit markup line, a doctest `>>>` prompt or a trailing `::` takes its whole indented block out of the prose, so a code block nested in a `.. note::` stays out.
- **Org mode** — Extracts paragraph text and heading titles, plus the parts of a structured node that render: the contents of a `#+begin_quote` or `#+begin_verse` block, table cells, footnote definitions (`[fn:1] …`) and the value of a `#+TITLE:`, `#+SUBTITLE:`, `#+CAPTION:` or `#+DESCRIPTION:` directive. Skips `#+begin_src` blocks, drawers (`:PROPERTIES:`), LaTeX environments, comments, and the remaining directives.
- **BibTeX** — Extracts prose from specific fields: `title`, `booktitle`, `abstract`, `note`, `annote`, `annotation`, `howpublished`, and `series`. Other fields (author, journal, year, etc.) are ignored. LaTeX commands inside values (e.g. `\emph{...}`) are handled via exclusion zones.
- **Typst** — Collects `text` nodes from paragraphs, headings, and list items. Skips code blocks (`` ``` ``), inline code (`` ` ``), math (`$...$` and `$ ... $`), `#code` expressions, set/show rules, let bindings, imports, includes, labels, references, URLs, escapes, and comments. Content blocks passed to a function (`#columns(2)[...]`, `#align(center)[...]`, `#figure(caption: [...])[...]`) are still checked — only the call itself and its non-content arguments are skipped. Inline markup (`*bold*`, `_italic_`) is bridged through.
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
