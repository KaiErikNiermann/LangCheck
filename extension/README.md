# Language Check

A fast, extensible grammar and style checker for Markdown, HTML, LaTeX, and more. Powered by a Rust core with tree-sitter parsing — checks run locally with no external service required.

## Features

- **Instant local checking** — built-in Harper engine gives sub-second feedback with no network dependency
- **Multi-engine support** — optionally add LanguageTool for deep grammar analysis, external tools like Vale, or custom WASM plugins
- **Smart prose extraction** — tree-sitter parsing skips code blocks, math environments, and markup so you only get relevant diagnostics
- **SpeedFix panel** — keyboard-driven batch review (`Alt+F`): press `1`–`9` for suggestions, `a` to add to dictionary, `i` to ignore, `Space` to skip
- **Inline suggestions** — inlay hints, ghost text completions, and quick-fix code actions
- **Prose insights** — word count, sentence count, and readability index in the status bar
- **Inspector** — debug view showing AST structure, extraction ranges, and check latency

### Supported Languages

Markdown, HTML, LaTeX, Typst, reStructuredText, BibTeX, Org-mode, MDX, XHTML, Sweave, and Forester — plus any language with a Schema Language Specification (SLS) file.

## Getting Started

1. Install the extension
2. Open a supported file — checking starts automatically
3. Press `Alt+F` to open SpeedFix for fast batch fixes

No configuration needed for basic usage. The local Harper engine works out of the box.

## Configuration

Create a `.languagecheck.yaml` in your workspace root for advanced settings:

```yaml
engines:
  harper: true
  languagetool: true
  languagetool_url: "http://localhost:8010"

rules:
  spelling.typo:
    severity: warning
  grammar.article:
    severity: off

auto_fix:
  - find: "teh"
    replace: "the"
```

Or run `Language Check: Config Init` from the command palette to generate a default config.

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `languageCheck.check.trigger` | `onChange` | Check on every change or only on save |
| `languageCheck.core.channel` | `stable` | Core binary release channel (stable/canary/dev) |
| `languageCheck.core.binaryPath` | — | Path to a custom core binary |
| `languageCheck.dictionaries.bundled` | `true` | Use bundled dictionaries |
| `languageCheck.dictionaries.paths` | `[]` | Additional dictionary file paths |
| `languageCheck.performance.highPerformanceMode` | `false` | Optimize for large files |
| `languageCheck.workspace.indexOnOpen` | `false` | Index workspace files on open |
| `languageCheck.trace.enable` | `false` | Enable protocol tracing for debugging |

## Commands

| Command | Description |
|---------|-------------|
| `Language Check: Check Document` | Run checks on the current file |
| `Language Check: Check Workspace` | Check all supported files in the workspace |
| `Language Check: Open SpeedFix` | Open the keyboard-driven fix panel (`Alt+F`) |
| `Language Check: Select Language` | Override the detected language for the current file |
| `Language Check: Open Inspector` | Open the debug inspector panel |
| `Language Check: Switch Core` | Switch between core binary channels |
| `Language Check: Skip LaTeX Environment` | Add a LaTeX environment to the skip list |
| `Language Check: Skip LaTeX Command` | Add a LaTeX command to the skip list |

## CLI

Language Check also ships as a standalone CLI:

```sh
# Install via Homebrew
brew install KaiErikNiermann/lang-check/lang-check

# Or via cargo
cargo install lang-check

# Check files
language-check check README.md
language-check fix docs/
language-check list-rules
```

## License

[MIT](https://github.com/KaiErikNiermann/lang-check/blob/main/LICENSE)
