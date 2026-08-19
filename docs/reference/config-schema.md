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
| `dictionaries`| [`DictionaryConfig`](#dictionaries)| See below     | Bundled and custom wordlists   |
| `languages`   | [`LanguageConfig`](#languages)     | See below     | Per-language settings          |

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

## Languages

| Field        | Type                                  | Default | Description                          |
|-------------|---------------------------------------|---------|--------------------------------------|
| `extensions`| `map<string, string[]>`               | `{}`    | Additional file extensions per language ID |
| `latex`     | [`LaTeXConfig`](#languages-latex)     | See below | LaTeX-specific settings            |

(languages-latex)=
### `languages.latex`

| Field               | Type       | Default | Description                                     |
|--------------------|------------|---------|--------------------------------------------------|
| `skip_environments`| `string[]` | `[]`    | Extra environment names to skip during prose extraction |

Environments listed here are skipped in addition to the built-in set (algorithm,
equation, tikzpicture, tabular, etc.). Use this for custom or niche environments
whose content should not be grammar-checked.

```yaml
languages:
  latex:
    skip_environments:
      - prooftree
      - mycustomenv
```

## Dictionaries

Words listed in a dictionary are never reported as spelling mistakes. Five
domain wordlists ship with the checker and all of them load by default.

| Field      | Type       | Default | Description                                          |
|------------|------------|---------|------------------------------------------------------|
| `bundled`  | `bool`     | `true`  | Load the bundled domain wordlists                    |
| `disabled` | `string[]` | `[]`    | Names of individual bundled wordlists to skip        |
| `paths`    | `string[]` | `[]`    | Extra wordlist files, one word per line, `#` comments |

```yaml
dictionaries:
  disabled: [companies]
  paths:
    - .languagecheck/project-terms.txt
```

### Bundled wordlists

These are the names accepted by `disabled`:

| Name              | Contents                                                          |
|-------------------|-------------------------------------------------------------------|
| `software-terms`  | Development tools, acronyms, and compound technical terms         |
| `typescript`      | TypeScript and JavaScript keywords, builtins, and API names       |
| `companies`       | Well-known company and brand names                                |
| `jargon`          | Computing jargon, hardware terms, and domain vocabulary           |
| `mathematics`     | Mathematics, category theory, type theory, and mathematical physics |

Set `bundled: false` to switch all five off at once; `disabled` turns off only the
ones you name and is ignored when `bundled` is false. An unrecognised name is
warned about in the server log and otherwise ignored, so a typo here never takes
the other wordlists down with it.

See `rust-core/dictionaries/THIRD_PARTY_NOTICES.md` for each list's source and
licensing.

### Hyphenated words

A hyphenated compound is accepted when every one of its parts is known
individually, so `Chern-Simons` resolves from `chern` and `simons`. This matters
because engines disagree about what they report: Harper flags the parts of a
compound separately, while LanguageTool flags the whole span. Requiring *all*
parts to be known keeps genuine typos visible — `Chern-Simmmons` and
`well-knownn` are still reported.

The same rule applies to words you add yourself and to any file listed in
`paths`, not just the bundled wordlists.

### Your own words

*Add to dictionary* in the editor writes to `.languagecheck/dictionary.txt` in the
workspace. That file is yours; the bundled wordlists are never written back to it.

## Names

Opt-in suppression of spelling diagnostics on human names. Off by default.

| Field            | Type     | Default      | Description                                              |
|-----------------|----------|--------------|----------------------------------------------------------|
| `enabled`       | `bool`   | `false`      | Drop spelling diagnostics on tokens detected as human names |
| `aggressiveness`| `string` | `"balanced"` | `conservative`, `balanced`, or `aggressive`              |

```yaml
names:
  enabled: true
  aggressiveness: balanced
```

The detector is engine-agnostic — it works the same whether Harper or LanguageTool
produced the diagnostic, because it reads only the flagged token, the surrounding
text, and the engine's own suggestion list.

A word is treated as a name only when **at least two independent signals** agree:

| Signal           | Meaning                                                          |
|-----------------|-------------------------------------------------------------------|
| `gazetteer`     | The word is a known given name or surname                          |
| `orphan`        | No suggestion is within edit distance 3 — not a plausible typo     |
| `no-suggestions`| The engine offered no correction at all                            |
| `repetition`    | The same spelling occurs more than once in the document            |
| `context`       | A title, salutation, possessive or citation pattern surrounds it   |
| `shape`         | Capitalised away from the start of a sentence                      |

Requiring two signals is what keeps real misspellings visible. `Hoare` is suppressed
because it is a known surname *and* capitalised mid-sentence; `thier` is not, because
it is lowercase and sits one edit from `their`. Raising `aggressiveness` lowers that
bar and will eventually cost you real typos.

Capitalisation is ignored as a signal for German (`de-*`), where every noun is
capitalised and the shape carries no information.

Use the **Names** tab in the Inspector to see exactly which words were suppressed and
which signals fired for each.
