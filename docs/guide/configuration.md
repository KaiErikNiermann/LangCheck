# Configuration

Language Check is configured via a `.languagecheck.yaml` file in your workspace root. YAML is preferred; `.languagecheck.yml` and `.languagecheck.json` are also supported.

## Engines

Control which checking engines are active:

```yaml
engines:
  harper: true           # Fast, local grammar/spelling (always recommended)
  languagetool: false    # Optional, requires a running LT server
  languagetool_url: "http://localhost:8010"
  english_engine: harper # Which engine checks English: "harper" or "languagetool"
```

When both Harper and LanguageTool are enabled, `english_engine` controls which one handles English content. Set it to `"languagetool"` to use LanguageTool for English and skip Harper entirely. The non-selected engine is automatically skipped for English text, avoiding duplicate diagnostics.

## Rule Overrides

Change severity or disable individual rules:

```yaml
rules:
  spelling.typo:
    severity: warning    # error | warning | info | hint | off
  grammar.article:
    severity: "off"      # Disable this rule entirely
```

## Exclude Patterns

Glob patterns to skip during workspace checking:

```yaml
exclude:
  - "node_modules/**"
  - ".git/**"
  - "vendor/**"
  - "*.min.js"
```

## Auto-Fix Rules

Define custom find-and-replace rules applied automatically:

```yaml
auto_fix:
  - find: "teh"
    replace: "the"
    description: "Fix common typo"
  - find: "colour"
    replace: "color"
    context: "American"    # Only apply when "American" appears in the text
```

## Performance

Tune performance for large workspaces:

```yaml
performance:
  high_performance_mode: false  # Only use Harper (skip LT and externals)
  debounce_ms: 300              # LSP debounce delay
  max_file_size: 1048576        # Skip files larger than 1MB (0 = unlimited)
```

## Full Example

Here's a `.languagecheck.yaml` putting it all together:

```yaml
engines:
  harper: true
  languagetool: true
  languagetool_url: "http://localhost:8010"
  english_engine: harper          # "harper" or "languagetool"
  external:
    - name: vale
      command: vale
      args: ["--output", "JSON"]
      extensions: [md, rst]

rules:
  spelling.typo:
    severity: warning
  grammar.article:
    severity: "off"

exclude:
  - "node_modules/**"
  - ".git/**"

auto_fix:
  - find: "teh"
    replace: "the"

performance:
  high_performance_mode: false
  debounce_ms: 300
```
