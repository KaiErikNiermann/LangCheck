# Configuration

Language Check is configured via a `.languagecheck.yaml` file in your workspace root. YAML is preferred; `.languagecheck.yml` and `.languagecheck.json` are also supported.

## Engines

Control which checking engines are active:

```yaml
engines:
  # Bool shorthand — just enable/disable:
  harper: true
  languagetool: false

  # Nested config — engine-specific settings:
  harper:
    enabled: true
    dialect: "American"       # American | British | Canadian | Australian | Indian
    linters:
      LongSentences: false    # Disable specific Harper rules

  languagetool:
    enabled: true
    url: "http://localhost:8010"
    level: "picky"            # "default" or "picky" (stricter rules)
    mother_tongue: "de-DE"    # For false-friends detection
    disabled_rules:
      - WHITESPACE_RULE
    enabled_rules: []
    disabled_categories: []
    enabled_categories: []

  vale:
    enabled: true
    config: ".vale.ini"       # Path to Vale config (auto-detected if omitted)

  proselint:
    enabled: false
    config: "proselint.json"  # Path to proselint config (auto-detected if omitted)

  spell_language: "en-US"     # BCP-47 tag for checking language
```

Both bool shorthand (`harper: true`) and nested config (`harper: { enabled: true, dialect: "British" }`) are supported. Use the shorthand when you only need to toggle an engine; use the nested form when you need engine-specific settings.

All enabled engines run concurrently and their diagnostics overlay. Engines that don't support the configured `spell_language` are automatically skipped (e.g. Harper only supports English). Duplicate diagnostics at the same range and rule are deduplicated.

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
  harper:
    enabled: true
    dialect: "American"
  languagetool:
    enabled: true
    url: "http://localhost:8010"
    level: "default"
  vale:
    enabled: true
    config: ".vale.ini"
  proselint: false
  spell_language: "en-US"
  external:
    - name: custom-checker
      command: ./my-checker
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
