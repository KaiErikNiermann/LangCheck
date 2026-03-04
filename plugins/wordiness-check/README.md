# Wordiness Check Plugin

A demo WASM plugin for [Language Check](https://github.com/KaiErikNiermann/LangCheck) that detects wordy phrases and suggests concise alternatives.

## Building

Requires [TinyGo](https://tinygo.org/getting-started/install/):

```bash
make build    # produces wordiness-check.wasm
```

## Testing

```bash
make test     # runs Go unit tests (no TinyGo needed)
```

## Usage

Copy `wordiness-check.wasm` to your project's plugin directory or configure it explicitly:

```yaml
# .languagecheck.yaml
engines:
  wasm_plugins:
    - name: wordiness-check
      path: path/to/wordiness-check.wasm
```

Or use auto-discovery:

```
.languagecheck/plugins/wordiness-check.wasm
```

## Detected Phrases

| Wordy Phrase | Suggested Replacement |
|---|---|
| in order to | to |
| due to the fact that | because |
| at this point in time | now |
| in the event that | if |
| a large number of | many |
| each and every | each |
| ... and 25+ more | |

See `main.go` for the full list.
