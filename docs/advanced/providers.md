# Custom Providers

Language Check supports external checker binaries that communicate via stdin/stdout JSON.

:::{note}
[Vale](https://vale.sh/) has built-in first-class support — use `engines.vale: true`
instead of registering it as a custom provider. See [Vale Setup](../guide/vale-setup.md).
:::

## Configuration

Register external providers in `.languagecheck.yaml`:

```yaml
engines:
  external:
    - name: custom-checker
      command: ./my-checker
    - name: another-tool
      command: /usr/bin/another-tool
      args: ["--format", "json"]
      extensions: [md, rst]     # markup it parses
      languages: ["en", "de"]   # languages it checks
```

`extensions` and `languages` are different questions, and a provider is skipped
when either excludes the document. Leaving one out means "all of them".

Declaring `languages` matters more than it looks: a provider that claims every
language makes the checker believe the passage was checked, which suppresses
the report saying nothing could read it — so a provider that only speaks
English silently hides the fact that a Hebrew paragraph went unchecked.

## Protocol

### Request (stdin)

The provider receives a JSON object on stdin:

```json
{
  "text": "The prose to check.",
  "language_id": "en-US"
}
```

`language_id` is the **natural** language being checked as a BCP-47 tag, not
the markup format — `en-US`, `de-DE`, `fr`. The document's markup is not sent;
declare `extensions` if the provider needs to know it.

`text` is one extracted prose range, not the whole file. A document is checked
range by range, so a provider is invoked once per range and its byte offsets
are relative to the text it was given.

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
| `severity`   | `number`   | No       | 1=Info, 2=Warning, 3=Error, 4=Hint (default: 2) |
| `confidence` | `number`   | No       | 0.0–1.0 confidence score (default: 0.7)  |

An optional field that is left out or set to `null` takes the default. An
output of `null` instead of an array means no diagnostics.

Rule IDs are automatically prefixed with `external.<provider-name>.` for namespacing.

## Error Handling

A provider that fails is reported as failed, not as having found nothing. Each of these is an error:

- The binary cannot be started (not found, not executable).
- The binary exits non-zero. The first line of its `stderr` goes into the error.
- The binary is killed after 30 seconds, or once it writes more than 16 MiB to `stdout`.
- Its output is not a JSON array of diagnostics.

The error is logged and counted against the provider's health. If no other
engine reported anything for the passage, it shows a notice that it went
unchecked rather than looking clean.

## High Performance Mode

External providers are skipped when `performance.high_performance_mode` is enabled.
