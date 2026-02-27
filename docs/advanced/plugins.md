# WASM Plugins

Language Check supports WebAssembly plugins loaded via [Extism](https://extism.org/).

## Configuration

Register WASM plugins in `.languagecheck.yaml`:

```yaml
engines:
  wasm_plugins:
    - name: custom-checker
      path: .languagecheck/plugins/checker.wasm
      extensions: [md, html]
    - name: style-linter
      path: /opt/plugins/style.wasm
```

## Plugin Interface

Plugins must export a `check` function with the following contract:

### Input

A JSON string passed as the function argument:

```json
{
  "text": "The document text to check.",
  "language_id": "markdown"
}
```

### Output

A JSON string returned as the function result — an array of diagnostics:

```json
[
  {
    "start_byte": 0,
    "end_byte": 3,
    "message": "Capitalize the first word.",
    "suggestions": ["The"],
    "rule_id": "style.capitalization",
    "severity": 2,
    "confidence": 0.9
  }
]
```

The diagnostic schema is identical to [external providers](providers.md).

## Plugin Discovery

Plugins can also be auto-discovered from a directory:

```
.languagecheck/
  plugins/
    spell-checker.wasm
    style-linter.wasm
```

Any `.wasm` file in the plugins directory is loaded automatically, with the filename (minus extension) used as the plugin name.

## Building Plugins

Plugins can be built with the [Extism PDK](https://extism.org/docs/write-a-plugin/) in any language that compiles to WebAssembly:

- **Rust**: `extism-pdk` crate
- **Go**: `extism-pdk-go`
- **JavaScript**: `@nicolo-ribaudo/extism-pdk`
- **AssemblyScript**, **Zig**, **C/C++**, **Haskell**

### Example (Rust)

```rust
use extism_pdk::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CheckRequest {
    text: String,
    language_id: String,
}

#[derive(Serialize)]
struct Diagnostic {
    start_byte: u32,
    end_byte: u32,
    message: String,
    suggestions: Vec<String>,
    rule_id: String,
    severity: i32,
    confidence: f32,
}

#[plugin_fn]
pub fn check(input: String) -> FnResult<String> {
    let req: CheckRequest = serde_json::from_str(&input)?;
    let mut diagnostics = Vec::new();

    // Your checking logic here...

    Ok(serde_json::to_string(&diagnostics)?)
}
```

## Error Handling

- Invalid WASM modules are logged and skipped during initialization.
- Runtime errors during `check()` calls return empty diagnostics.
- WASM plugins are skipped in High Performance Mode.

## Rule ID Namespacing

Rule IDs from WASM plugins are prefixed with `wasm.<plugin-name>.` for disambiguation.
