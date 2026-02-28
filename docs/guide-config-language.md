# Adding Language Support via Config (No Code Required)

lang-check ships with built-in support for a handful of prose-heavy file
formats.  If the format you need is structurally similar to one of those
languages, you can add support for new file extensions with a single config
change -- no Rust code, no tree-sitter grammar, no rebuild.

## What this gives you

You map a new file extension to an existing supported language.  lang-check
will then:

- recognize files with that extension during workspace scanning,
- parse them with the target language's tree-sitter grammar,
- extract prose regions using the target language's extractor, and
- apply all spelling / grammar checks to those regions.

## What this does NOT give you

- **Custom AST-aware extraction.**  The file is parsed *as the target
  language*.  Any syntax that does not exist in the target grammar (e.g. JSX
  components inside an `.mdx` file) will not be understood by the parser and
  will be treated as prose, which may produce false positives.
- **Language-specific math or code exclusions.**  Only the exclusion zones
  defined for the target language apply.
- **A new tree-sitter grammar.**  If the file format has meaningfully
  different structure, you need the plugin path instead (see
  [guide-plugin-language.md](guide-plugin-language.md)).

## How it works

lang-check's configuration file (`.languagecheck.yaml` at your workspace root)
accepts a `languages.extensions` map.  Each key is a **canonical language ID**
and its value is a list of additional file extensions (without leading dots) to
associate with that language.

When lang-check encounters a file, it checks user-defined extension mappings
*first*, then falls back to the built-in table.  This means you can also
override built-in mappings if needed.

## Currently supported base languages

These are the canonical language IDs you can map extensions to:

| Language ID  | Built-in extensions          |
|--------------|------------------------------|
| `markdown`   | `.md`, `.markdown`           |
| `html`       | `.html`, `.htm`              |
| `latex`      | `.tex`, `.latex`, `.ltx`     |
| `forester`   | `.tree`                      |
| `tinylang`   | `.tiny`                      |

## Step-by-step example: `.mdx` files as Markdown

MDX files are Markdown with embedded JSX.  The Markdown portions will be
checked correctly; JSX blocks that the Markdown parser cannot parse will be
treated as inline text.

1. Create or open `.languagecheck.yaml` in your project root.
2. Add the extension mapping:

```yaml
languages:
  extensions:
    markdown:
      - mdx
```

3. Verify it works:

```
language-check check myfile.mdx
```

lang-check will parse `myfile.mdx` using the Markdown grammar and report any
spelling or grammar issues it finds in the prose regions.

## Another example: `.xhtml` files as HTML

XHTML is structurally close enough to HTML that the HTML grammar handles it
well.  (Note that `.htm` is already built-in, so you do not need to add it.)

```yaml
languages:
  extensions:
    html:
      - xhtml
```

You can list multiple extensions under the same language:

```yaml
languages:
  extensions:
    html:
      - xhtml
      - mjml
```

## Verifying your configuration

Run the CLI against a file with the new extension:

```
language-check check path/to/file.xhtml
```

If the extension is mapped correctly, lang-check will parse the file and report
diagnostics.  If the mapping is missing, the file will fall back to the default
language (Markdown).

## Limitations

- **No custom AST parsing.** The file is parsed entirely as the target
  language.  Constructs that do not exist in the target grammar (e.g. JSX
  inside Markdown, or custom directives inside LaTeX) are not recognized by the
  parser and will be treated as prose.  This can produce false-positive
  diagnostics on syntax tokens.

- **Language-specific constructs are invisible.** If the source format has its
  own code fences, math delimiters, or metadata blocks that differ from the
  target language, they will not be excluded from checking.

- **No custom math or code exclusions.** Only the exclusion zones that the
  target language defines (e.g. fenced code blocks and inline code in Markdown,
  `\begin{equation}` in LaTeX) will be honored.

- **Extension matching is case-insensitive.** `.MDX` and `.mdx` are treated
  identically.

- **For full support, use the plugin path.** If you need a dedicated
  tree-sitter grammar or custom prose extraction, see
  [guide-plugin-language.md](guide-plugin-language.md).
