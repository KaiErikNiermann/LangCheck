# Configuration Schema

Complete reference for `.languagecheck.yaml`.

## Top-Level Fields

| Field         | Type                        | Default              | Description                    |
|---------------|-----------------------------|-----------------------|-------------------------------|
| `engines`     | [`EngineConfig`](#engines)  | See below             | Checker engine configuration  |
| `rules`       | `map<string, RuleConfig>`   | `{}`                  | Per-rule severity overrides   |
| `exclude`     | `string[]`                  | `["node_modules/**", ".git/**"]` | Glob patterns to skip |
| `auto_fix`    | [`AutoFixRule[]`](#auto-fix)| `[]`                  | Custom find/replace rules     |
| `performance` | [`PerformanceConfig`](#performance)| See below     | Performance tuning            |

## Engines

| Field              | Type                           | Default                 | Description              |
|-------------------|---------------------------------|--------------------------|--------------------------|
| `harper`          | `bool`                          | `true`                   | Enable Harper engine     |
| `languagetool`    | `bool`                          | `true`                   | Enable LanguageTool      |
| `languagetool_url`| `string`                        | `"http://localhost:8010"` | LT server URL           |
| `external`        | [`ExternalProvider[]`](#external-providers) | `[]`    | External checker binaries|
| `wasm_plugins`    | [`WasmPlugin[]`](#wasm-plugins) | `[]`                     | WASM checker plugins     |

## External Providers

| Field       | Type       | Required | Description                          |
|-------------|------------|----------|--------------------------------------|
| `name`      | `string`   | Yes      | Display name                         |
| `command`   | `string`   | Yes      | Path to executable                   |
| `args`      | `string[]` | No       | Command-line arguments               |
| `extensions`| `string[]` | No       | File extensions to check (empty=all) |

## WASM Plugins

| Field       | Type       | Required | Description                          |
|-------------|------------|----------|--------------------------------------|
| `name`      | `string`   | Yes      | Display name                         |
| `path`      | `string`   | Yes      | Path to `.wasm` file                 |
| `extensions`| `string[]` | No       | File extensions to check (empty=all) |

## Rule Config

| Field      | Type     | Description                              |
|-----------|----------|------------------------------------------|
| `severity`| `string` | `"error"`, `"warning"`, `"info"`, `"hint"`, or `"off"` |

## Auto-Fix

| Field        | Type     | Required | Description                         |
|-------------|----------|----------|-------------------------------------|
| `find`       | `string` | Yes      | Text pattern to find                |
| `replace`    | `string` | Yes      | Replacement text                    |
| `context`    | `string` | No       | Only apply when context string exists|
| `description`| `string` | No       | Human-readable rule description     |

## Performance

| Field                  | Type     | Default | Description                          |
|-----------------------|----------|---------|--------------------------------------|
| `high_performance_mode`| `bool`  | `false` | Only use Harper (skip LT/externals) |
| `debounce_ms`          | `number`| `300`   | LSP debounce delay in milliseconds  |
| `max_file_size`        | `number`| `0`     | Max file size in bytes (0=unlimited)|
