# Writing a WASM Plugin

This guide walks through building a WASM plugin for Language Check using Go and TinyGo. The same principles apply to any language with an [Extism PDK](https://extism.org/docs/write-a-plugin/).

## Overview

Language Check loads WASM plugins via [Extism](https://extism.org/). Each plugin exports a `check` function that receives prose text and returns diagnostics. Plugins run in a sandboxed WebAssembly environment — they cannot access the filesystem, network, or host memory.

## Protocol

### Input

Your `check` function receives a JSON string:

```json
{
  "text": "The document text to check.",
  "language_id": "markdown"
}
```

### Output

Return a JSON string — an array of diagnostics:

```json
[
  {
    "start_byte": 0,
    "end_byte": 11,
    "message": "Wordy phrase: consider using \"to\" instead",
    "suggestions": ["to"],
    "rule_id": "wordiness",
    "severity": 1,
    "confidence": 0.8
  }
]
```

| Field | Type | Required | Description |
|---|---|---|---|
| `start_byte` | integer | yes | Start byte offset in the input text |
| `end_byte` | integer | yes | End byte offset (exclusive) |
| `message` | string | yes | Human-readable description of the issue |
| `suggestions` | string[] | no | Replacement suggestions (first is preferred) |
| `rule_id` | string | no | Rule identifier (namespaced as `wasm.<plugin>.<rule_id>`) |
| `severity` | integer | no | 1 = Information, 2 = Warning (default), 3 = Error |
| `confidence` | float | no | 0.0–1.0, defaults to 0.7 if omitted |

Diagnostics from plugins are treated identically to built-in engine results — `suggestions` automatically appear in the SpeedFix panel, inlay hints, inline ghost text completions, and code actions. The first suggestion in the array is used as the preferred quick-fix. An empty string `""` suggestion means "remove the matched text", and suggestions prefixed with `Insert "..."` insert text at the diagnostic end position rather than replacing.

## Setting Up

### Prerequisites

- [Go](https://go.dev/dl/) 1.22+
- [TinyGo](https://tinygo.org/getting-started/install/) 0.34+

### Project Structure

```
plugins/my-checker/
├── detect.go        # Detection logic (testable with standard Go)
├── detect_test.go   # Unit tests
├── main.go          # Extism PDK glue (build-tagged for TinyGo)
├── go.mod
├── go.sum
├── Makefile
└── my-checker.wasm  # Built artifact
```

## Writing the Plugin

### Step 1: Define Types

Create `detect.go` with your data types and detection logic:

```go
package main

type CheckRequest struct {
    Text       string `json:"text"`
    LanguageID string `json:"language_id"`
}

type Diagnostic struct {
    StartByte   int      `json:"start_byte"`
    EndByte     int      `json:"end_byte"`
    Message     string   `json:"message"`
    Suggestions []string `json:"suggestions"`
    RuleID      string   `json:"rule_id"`
    Severity    int      `json:"severity"`
    Confidence  float32  `json:"confidence"`
}
```

### Step 2: Implement Detection

Add your checking logic to `detect.go`. Keep it in a pure function that takes a string and returns diagnostics:

```go
func FindIssues(text string) []Diagnostic {
    // Your detection logic here
    return diagnostics
}
```

This separation is important — `detect.go` uses only standard library imports and can be tested with `go test`.

### Step 3: Wire Up Extism

Create `main.go` with the Extism PDK glue. Use a `//go:build tinygo` tag so standard Go ignores it during testing:

```go
//go:build tinygo

package main

import (
    "encoding/json"
    "github.com/extism/go-pdk"
)

//export check
func check() int32 {
    input := pdk.Input()

    var req CheckRequest
    if err := json.Unmarshal(input, &req); err != nil {
        pdk.SetError(err)
        return 1
    }

    diagnostics := FindIssues(req.Text)

    output, err := json.Marshal(diagnostics)
    if err != nil {
        pdk.SetError(err)
        return 1
    }

    pdk.Output(output)
    return 0
}

func main() {}
```

Key points:
- The `//export check` directive exposes the function to the host
- `pdk.Input()` reads the JSON input from the host
- `pdk.Output()` writes the JSON response back
- `pdk.SetError()` reports errors to the host
- Return `0` for success, non-zero for failure
- `func main() {}` is required but unused

### Step 4: Initialize the Module

```bash
go mod init github.com/you/my-checker
go mod tidy
```

## Testing

### Unit Tests

Write tests in `detect_test.go` that exercise `FindIssues()` directly:

```go
package main

import "testing"

func TestFindsIssue(t *testing.T) {
    diags := FindIssues("some problematic text")
    if len(diags) != 1 {
        t.Fatalf("expected 1 diagnostic, got %d", len(diags))
    }
}
```

Run with standard Go (no TinyGo needed):

```bash
go test -v ./...
```

### Building

```bash
tinygo build -o my-checker.wasm -target wasi .
```

### Manual Integration Test

Create a test config and run the CLI:

```yaml
# .languagecheck.yaml
engines:
  wasm_plugins:
    - name: my-checker
      path: plugins/my-checker/my-checker.wasm
```

```bash
echo "some problematic text" | language-check --stdin --language markdown
```

## Integrating with Language Check

### Explicit Configuration

Register your plugin in `.languagecheck.yaml`:

```yaml
engines:
  wasm_plugins:
    - name: my-checker
      path: path/to/my-checker.wasm
      extensions: [md, txt]  # optional: limit to specific file types
```

### Auto-Discovery

Place the `.wasm` file in the auto-discovery directory:

```
.languagecheck/plugins/my-checker.wasm
```

The filename (minus `.wasm`) becomes the plugin name.

## Debugging

- **Extism errors**: The host logs plugin errors at `warn` level. Enable tracing in VS Code or use `--trace` on the CLI.
- **JSON parse failures**: If your output isn't valid JSON, the host silently returns empty diagnostics. Test your JSON serialization in unit tests.
- **Byte offsets**: Offsets must be valid UTF-8 byte positions in the input text. Off-by-one errors here cause garbled diagnostic ranges.
- **Empty output**: Return `[]` (empty JSON array), not an empty string, when there are no issues.

## Other Languages

The Extism PDK is available for many languages:

| Language | PDK | Build Target |
|---|---|---|
| **Rust** | `extism-pdk` crate | `cargo build --target wasm32-unknown-unknown` |
| **Go** | `github.com/extism/go-pdk` | `tinygo build -target wasi` |
| **JavaScript** | `@nicolo-ribaudo/extism-pdk` | Javy / QuickJS |
| **AssemblyScript** | `@nicolo-ribaudo/extism-pdk` | asc compiler |
| **Zig** | `extism-pdk-zig` | `zig build -Dtarget=wasm32-wasi` |
| **C/C++** | `extism-pdk.h` | `clang --target=wasm32-wasi` |

See the [Extism documentation](https://extism.org/docs/write-a-plugin/) and the [WASM plugins reference](advanced/plugins.md) for details.

## Reference Implementation

The `plugins/wordiness-check/` directory in the Language Check repository is a complete working example. It detects wordy phrases (e.g. "in order to" → "to") and includes:

- Detection logic with word-boundary matching
- Comprehensive unit tests
- TinyGo build configuration
- Rust integration tests (`rust-core/tests/wasm_plugin.rs`)
