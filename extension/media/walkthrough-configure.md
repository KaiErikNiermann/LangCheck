## Configuration

Create a `.languagecheck.yaml` file in your workspace root to customize behavior:

```yaml
engines:
  harper: true
  languagetool: false

rules:
  spelling.typo:
    severity: warning
  grammar.article:
    severity: "off"

auto_fix:
  - find: "teh"
    replace: "the"

performance:
  high_performance_mode: false
  debounce_ms: 300
```

Run **Language Check: Check Current Document** from the Command Palette to test your configuration.
