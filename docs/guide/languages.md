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

## More than one language in one file

`engines.spell_language` is the document default, not the only answer. A thesis
in French quoting English, or a German paper with an English abstract, is
checked passage by passage: the prose is grouped by language and each group
goes to the engines that read it, so Harper handles the English while
LanguageTool handles the French.

Three things declare a language, strongest first.

**A region directive.** Works in every format, and is the only option where the
markup has nothing to say:

```markdown
<!-- lang-check-begin lang:fr -->
Ceci est du texte français.
<!-- lang-check-end -->
```

**A scope marker**, which runs until the next one:

```markdown
<!-- lang: fr -->
```

**The markup's own declaration**, where the format has one. Typst does:

```typst
#set text(lang: "fr", region: "CH")   // the rest of the enclosing block
#text(lang: "en")[An English aside.]  // just this content
```

That last one needs no extra annotation at all — the `lang:` an author already
writes for hyphenation and quotation marks is the one the checker reads, and
`region:` becomes the BCP-47 subtag.

See the [directives reference](../reference/directives.md) for the full syntax,
and [`examples/typst/`](https://github.com/KaiErikNiermann/LangCheck/tree/main/examples/typst)
for a worked document.

### When nothing can read the language

Not every language has an engine. LanguageTool has no Hebrew, and Harper reads
only English. Rather than let the passage pass as clean, the checker reports a
`languagecheck.no-provider` diagnostic naming the language, and does not mark
the engine unhealthy for declining one.

### Bare tags

A declaration with no region is resolved before it reaches the engines: it
takes the document default's region when the language agrees, so `lang: "en"`
under an `en-GB` document means `en-GB`, and a known variant otherwise.

This is not cosmetic. LanguageTool accepts bare `en` and `de` and then reports
no spelling errors at all in them, so an unresolved tag would check nothing and
look clean.
