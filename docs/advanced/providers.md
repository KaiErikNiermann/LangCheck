# Custom Providers

Language Check supports external checker binaries that communicate via stdin/stdout JSON.

## Configuration

Register external providers in `.languagecheck.yaml`:

```yaml
engines:
  external:
    - name: vale
      command: /usr/bin/vale
      args: ["--output", "JSON"]
      extensions: [md, rst]
    - name: custom-checker
      command: ./my-checker
```

## Protocol

### Request (stdin)

The provider receives a JSON object on stdin:

```json
{
  "text": "The full document text to check.",
  "language_id": "markdown"
}
```

### Response (stdout)

The provider must return a JSON array of diagnostics on stdout:

```json
[
  {
    "start_byte": 4,
    "end_byte": 8,
    "message": "Consider using 'complete' instead of 'full'.",
    "suggestions": ["complete", "entire"],
    "rule_id": "style.word-choice",
    "severity": 2,
    "confidence": 0.8
  }
]
```

### Diagnostic Fields

| Field        | Type       | Required | Description                              |
|-------------|------------|----------|------------------------------------------|
| `start_byte` | `number`   | Yes      | Start byte offset (UTF-8)                |
| `end_byte`   | `number`   | Yes      | End byte offset (UTF-8)                  |
| `message`    | `string`   | Yes      | Human-readable description               |
| `suggestions`| `string[]` | No       | Replacement suggestions (default: `[]`)  |
| `rule_id`    | `string`   | No       | Rule identifier (default: provider name) |
| `severity`   | `number`   | No       | 1=Error, 2=Warning, 3=Info, 4=Hint       |
| `confidence` | `number`   | No       | 0.0–1.0 confidence score (default: 0.7)  |

Rule IDs are automatically prefixed with `external.<provider-name>.` for namespacing.

## Error Handling

- If the binary is not found, the provider is silently skipped.
- If the binary exits non-zero, the error is logged and no diagnostics are returned.
- If the output is not valid JSON, the error is logged and no diagnostics are returned.

## High Performance Mode

External providers are skipped when `performance.high_performance_mode` is enabled.
