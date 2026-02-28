# lang-check Documentation

## Overview

lang-check is a grammar, spelling, and style checker for structured markup documents. It uses
[tree-sitter](https://tree-sitter.github.io/) to parse each document into an AST, then walks
the syntax tree to extract only the prose regions (paragraphs, headings, list items, etc.),
skipping code blocks, math, structural commands, and other non-prose constructs. The extracted
prose is fed into one or more checker engines -- primarily
[Harper](https://github.com/elijah-potter/harper) -- which produce diagnostics with accurate
source positions mapped back to the original document.

The project ships as a VS Code extension backed by a Rust core that communicates over a
Protobuf-based protocol.

## Supported Languages

| Language          | Extensions                   | Canonical ID | Parser Source                                        |
|-------------------|------------------------------|--------------|------------------------------------------------------|
| Markdown          | `.md`, `.markdown`           | `markdown`   | [tree-sitter-md](https://crates.io/crates/tree-sitter-md) (crates.io) |
| HTML              | `.html`, `.htm`              | `html`       | [tree-sitter-html](https://crates.io/crates/tree-sitter-html) (crates.io) |
| LaTeX             | `.tex`, `.latex`, `.ltx`     | `latex`      | [codebook-tree-sitter-latex](https://crates.io/crates/codebook-tree-sitter-latex) (crates.io) |
| Forester          | `.tree`                      | `forester`   | Vendored tree-sitter-forester (`rust-core/tree-sitter-forester/`) |
| TinyLang          | `.tiny`                      | `tinylang`   | Vendored tree-sitter-tinylang (`rust-core/tree-sitter-tinylang/`) -- demo/reference language |
| reStructuredText  | `.rst`, `.rest`              | `rst`        | [tree-sitter-rst](https://crates.io/crates/tree-sitter-rst) (crates.io) |

### Language ID Aliases

VS Code may report a language ID that differs from the canonical ID above. These aliases are
resolved automatically:

| Alias   | Resolves to |
|---------|-------------|
| `mdx`   | `markdown`  |
| `xhtml` | `html`      |

When a file has no recognized extension and no user-defined mapping, lang-check defaults to
`markdown`.

## File Extension Aliasing

You can map additional file extensions to any of the canonical language IDs above without
writing code. Add a `languages.extensions` section to your `.languagecheck.yaml`:

```yaml
languages:
  extensions:
    markdown:
      - mdx
      - Rmd
    latex:
      - sty
    html:
      - xhtml
      - mjml
```

User-defined extension mappings take priority over built-in mappings, and matching is
case-insensitive (`.MDX` and `.mdx` are treated identically).

For a full walkthrough, see [guide-config-language.md](guide-config-language.md).

## Adding Language Support

There are two paths for adding support for a new file format:

### Config-only path (no code changes)

If the format is structurally similar to an existing language (e.g. MDX is close to Markdown),
map its file extension to the existing canonical ID via `languages.extensions`. The file will be
parsed with that language's tree-sitter grammar and prose extractor. This is fast but does not
handle syntax that the target grammar cannot parse.

See [guide-config-language.md](guide-config-language.md).

### Plugin path (full AST-aware support)

If the format has meaningfully different structure, you write a tree-sitter grammar and a Rust
prose-extraction module. This gives you custom AST-aware extraction, math/code exclusion zones,
and structural command filtering.

See [guide-plugin-language.md](guide-plugin-language.md).

## Configuration

lang-check loads configuration from `.languagecheck.yaml` (or `.languagecheck.yml`, or
`.languagecheck.json` for backward compatibility) at the workspace root. YAML takes precedence
over JSON when both exist. When no config file is found, defaults are used.

### Top-Level Fields

| Field           | Type                              | Default                          | Description                         |
|-----------------|-----------------------------------|----------------------------------|-------------------------------------|
| `engines`       | `EngineConfig`                    | Harper on, LT off                | Checker engine configuration        |
| `rules`         | `map<string, RuleConfig>`         | `{}`                             | Per-rule severity overrides         |
| `exclude`       | `string[]`                        | See below                        | Glob patterns for files to skip     |
| `auto_fix`      | `AutoFixRule[]`                   | `[]`                             | Custom find/replace rules           |
| `performance`   | `PerformanceConfig`               | See below                        | Performance tuning                  |
| `dictionaries`  | `DictionaryConfig`                | Bundled on, no extra paths       | Dictionary configuration            |
| `languages`     | `LanguageConfig`                  | No extra extensions              | File extension aliasing             |

### engines

| Field              | Type                  | Default                  | Description                          |
|--------------------|-----------------------|--------------------------|--------------------------------------|
| `harper`           | `bool`                | `true`                   | Enable the Harper engine             |
| `languagetool`     | `bool`                | `false`                  | Enable LanguageTool integration      |
| `languagetool_url` | `string`              | `"http://localhost:8010"` | LanguageTool server URL             |
| `external`         | `ExternalProvider[]`  | `[]`                     | External checker binaries            |
| `wasm_plugins`     | `WasmPlugin[]`        | `[]`                     | WASM checker plugins (Extism)        |

### rules

Map from rule ID to a severity override. Valid severities: `"error"`, `"warning"`, `"info"`,
`"hint"`, `"off"`.

```yaml
rules:
  spelling.typo:
    severity: warning
  readability.sentence_length:
    severity: "off"
```

### exclude

Glob patterns for files and directories to skip. Defaults:

```
node_modules/**  .git/**  target/**  dist/**  build/**
.next/**  .nuxt/**  vendor/**  __pycache__/**  .venv/**
venv/**  .tox/**  .mypy_cache/**  *.min.js  *.min.css
*.bundle.js  package-lock.json  yarn.lock  pnpm-lock.yaml
```

### auto_fix

Custom find/replace rules applied before checking:

```yaml
auto_fix:
  - find: "teh"
    replace: "the"
    description: "Fix common typo"
  - find: "colour"
    replace: "color"
    context: "American"    # only apply when "American" appears in the text
```

### performance

| Field                   | Type     | Default | Description                                       |
|-------------------------|----------|---------|---------------------------------------------------|
| `high_performance_mode` | `bool`   | `false` | Only use Harper; skip LT, externals, and WASM     |
| `debounce_ms`           | `number` | `300`   | LSP debounce delay in milliseconds                |
| `max_file_size`         | `number` | `0`     | Max file size in bytes to check (0 = unlimited)   |

### dictionaries

| Field     | Type       | Default | Description                                              |
|-----------|------------|---------|----------------------------------------------------------|
| `bundled` | `bool`     | `true`  | Load bundled domain-specific dictionaries                |
| `paths`   | `string[]` | `[]`    | Paths to additional wordlist files (one word per line)   |

### languages.extensions

Map canonical language IDs to additional file extensions (without leading dots):

```yaml
languages:
  extensions:
    markdown: [mdx, Rmd]
    latex: [sty]
```

### External Providers

External checkers are binaries that communicate via stdin/stdout JSON. The binary receives
`{"text": "...", "language_id": "..."}` on stdin and returns an array of diagnostics on stdout.

```yaml
engines:
  external:
    - name: vale
      command: /usr/bin/vale
      args: ["--output", "JSON"]
      extensions: [md, rst]
```

### WASM Plugins

WASM plugins are loaded via Extism. They must export a `check` function that receives a JSON
string and returns a JSON array of diagnostics.

```yaml
engines:
  wasm_plugins:
    - name: custom-checker
      path: .languagecheck/plugins/checker.wasm
      extensions: [md, html]
```

For the full configuration schema, see [reference/config-schema.md](reference/config-schema.md).

## Architecture

The checking pipeline has four stages:

1. **Tree-sitter parsing** -- The document is parsed into an AST using the tree-sitter grammar
   for the detected language. Language detection checks user-defined extension mappings first,
   then built-in mappings, and defaults to Markdown.

2. **Prose extraction** -- A language-specific extractor walks the AST to collect `ProseRange`
   values: byte ranges that contain human-written prose. Code blocks, math environments,
   structural commands, comments, and preamble regions are excluded. Display math within prose
   paragraphs is handled via exclusion zones (byte ranges replaced with spaces) so that
   surrounding prose remains a single chunk and diagnostics retain correct byte offsets.

3. **Checker engines** -- Each extracted prose region is sent to the enabled checker engines.
   The default engine is [Harper](https://github.com/elijah-potter/harper) (an offline Rust
   grammar checker). Optional engines include LanguageTool (requires a running server),
   external checker binaries, and WASM plugins. An orchestrator dispatches prose to all enabled
   engines and collects diagnostics. High Performance Mode restricts checking to Harper only.

4. **Diagnostics** -- Engine results are normalized (rule IDs, severity overrides from config),
   filtered against ignore-comment directives, and mapped back to document-level source
   positions. The VS Code extension receives diagnostics over a Protobuf-based protocol and
   renders them as inline squiggles with quick-fix code actions.

## VS Code Extension

### Commands

| Command                                  | Title                                  | Keybinding     |
|------------------------------------------|----------------------------------------|----------------|
| `language-check.checkDocument`           | Language Check: Check Current Document |                |
| `language-check.openSpeedFix`            | Language Check: Open SpeedFix          | `Alt+F`        |
| `language-check.checkWorkspace`          | Language Check: Check Workspace        |                |
| `language-check.selectLanguage`          | Language Check: Select Language        |                |
| `language-check.openInspector`           | Language Check: Open Inspector         |                |
| `language-check.switchCore`              | Language Check: Switch Core Binary     |                |
| `language-check.toggleTrace`             | Language Check: Toggle Protobuf Trace  |                |
| `language-check.showTrace`               | Language Check: Show Protobuf Trace    |                |

### Extension Settings

| Setting                                       | Type       | Default      | Description                                              |
|-----------------------------------------------|------------|--------------|----------------------------------------------------------|
| `languageCheck.core.channel`                  | `string`   | `"stable"`   | Core binary channel: `stable`, `canary`, or `dev`        |
| `languageCheck.core.binaryPath`               | `string`   | `""`         | Custom path to `language-check-server` binary            |
| `languageCheck.trace.enable`                  | `bool`     | `false`      | Enable Protobuf message tracing to the output channel    |
| `languageCheck.check.trigger`                 | `string`   | `"onChange"` | When to check: `onChange` (with debounce) or `onSave`    |
| `languageCheck.performance.highPerformanceMode`| `bool`    | `false`      | Low-resource mode: Harper only, simplified SpeedFix UI   |
| `languageCheck.dictionaries.bundled`          | `bool`     | `true`       | Load bundled domain-specific dictionaries                |
| `languageCheck.dictionaries.paths`            | `string[]` | `[]`         | Paths to additional wordlist files                       |

### Activation

The extension activates on the following VS Code language IDs: `markdown`, `html`, `latex`,
`forester`, `tinylang`, `rst`, `mdx`, `xhtml`.
