# Configuration Schema

Complete reference for `.languagecheck.yaml`.

## Editor Completion

The extension ships a JSON Schema for the config file, generated from the same types the
core parses it with. In VS Code, `.languagecheck.json` gets completion and validation out
of the box. `.languagecheck.yaml` needs the
[Red Hat YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
extension, which the extension offers to install the first time you open the file.

Other editors running `yaml-language-server` can load the schema with a modeline:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/KaiErikNiermann/LangCheck/main/extension/schemas/languagecheck.schema.json
```

`language-check config schema` prints the schema for the installed version.

## Top-Level Fields

| Field         | Type                        | Default              | Description                    |
|---------------|-----------------------------|-----------------------|-------------------------------|
| `engines`     | [`EngineConfig`](#engines)  | See below             | Checker engine configuration  |
| `rules`       | `map<string, RuleConfig>`   | `{}`                  | Per-rule severity overrides   |
| `include`     | `string[]`                  | `[]`                  | Glob patterns to check (empty: every file) |
| `file_types`  | `string[]`                  | `[]`                  | Extensions to check, no leading dot (empty: every type) |
| `exclude`     | `string[]`                  | `["node_modules/**", ".git/**"]` | Glob patterns to skip |
| `auto_fix`    | [`AutoFixRule[]`](#auto-fix)| `[]`                  | Custom find/replace rules     |
| `performance` | [`PerformanceConfig`](#performance)| See below     | Performance tuning            |
| `dictionaries`| [`DictionaryConfig`](#dictionaries)| See below     | Bundled and custom wordlists   |
| `morphology`  | [`MorphologyConfig`](#morphology)  | See below     | Affixed forms of known words   |
| `identifiers` | [`IdentifierConfig`](#identifiers) | See below     | Skip `snake_case`/`camelCase`  |
| `languages`   | [`LanguageConfig`](#languages)     | See below     | Per-language settings          |

## Engines

| Field            | Type                                        | Default   | Description                 |
|------------------|---------------------------------------------|-----------|-----------------------------|
| `harper`         | `bool` or `HarperConfig`                    | `true`    | Enable Harper engine        |
| `languagetool`   | `bool` or `LanguageToolConfig`              | `false`   | Enable LanguageTool         |
| `vale`           | `bool` or `ValeConfig`                      | `false`   | Enable Vale                 |
| `proselint`      | `bool` or `ProselintConfig`                 | `false`   | Enable proselint            |
| `hunspell`       | `bool` or [`HunspellConfig`](#hunspellconfig) | `false`   | Enable Hunspell             |
| `spell_language` | `string`                                    | `"en-US"` | BCP-47 tag to check against |
| `external`       | [`ExternalProvider[]`](#external-providers) | `[]`      | External checker binaries   |
| `wasm_plugins`   | [`WasmPlugin[]`](#wasm-plugins)             | `[]`      | WASM checker plugins        |

Every engine accepts either a bool shorthand (`languagetool: true`) or a nested
table. Engine-specific settings — including the LanguageTool server URL — live
inside that table:

```yaml
engines:
  spell_language: fr
  languagetool:
    enabled: true
    url: "http://10.0.10.3:8003"   # default: http://localhost:8010
    level: "picky"
```

### LanguageToolConfig

| Field                     | Type       | Default                     | Description                        |
|---------------------------|------------|-----------------------------|------------------------------------|
| `enabled`                 | `bool`     | `false`                     | Enable the engine                  |
| `url`                     | `string`   | `"http://localhost:8010"`   | Server base URL (no `/v2/check`)   |
| `level`                   | `string`   | `"default"`                 | `default` or `picky`               |
| `mother_tongue`           | `string`   | unset                       | BCP-47 tag for false friends       |
| `disabled_rules`          | `string[]` | `[]`                        | Rule IDs to switch off             |
| `enabled_rules`           | `string[]` | `[]`                        | Extra rule IDs to switch on        |
| `disabled_categories`     | `string[]` | `[]`                        | Category IDs to switch off         |
| `enabled_categories`      | `string[]` | `[]`                        | Extra category IDs to switch on    |
| `max_concurrent_requests` | `int`      | `8`                         | In-flight `/v2/check` requests     |
| `max_request_bytes`       | `int`      | `4096`                      | Prose per request; `0` sends one request per range |

```{deprecated} 0.5.1
The flat `engines.languagetool_url` and `engines.vale_config` keys are aliases
for `engines.languagetool.url` and `engines.vale.config`. They are still read,
but they log a warning and will be removed in a future release.
```

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
| `debounce_ms`          | `number`| `500`   | Delay after the last keystroke, in milliseconds; `0` checks every change |
| `max_file_size`        | `number`| `0`     | Max file size in bytes (0=unlimited)|
| `result_cache_entries` | `number`| `131072`| Engine answers kept, keyed by the prose that produced them; `0` disables |
| `max_range_bytes`      | `number`| `2048`  | Longest prose range handed on; longer ones split at sentence bounds. `0` disables |

## Languages

| Field        | Type                                  | Default | Description                          |
|-------------|---------------------------------------|---------|--------------------------------------|
| `extensions`| `map<string, string[]>`               | `{}`    | Additional file extensions per language ID |
| `latex`     | [`LaTeXConfig`](#languages-latex)     | See below | LaTeX-specific settings            |

(languages-latex)=
### HunspellConfig

Spelling for the languages the other engines do not read. See
[Hunspell Setup](../guide/hunspell-setup.md).

| Field              | Type                 | Default | Description                                               |
|--------------------|----------------------|---------|-----------------------------------------------------------|
| `enabled`          | `bool`               | `false` | Enable the engine                                          |
| `languages`        | `string[]`           | `[]`    | BCP-47 tags to check; empty means any language with a pack |
| `dictionary_paths` | `map<string,string>` | `{}`    | Per-language override: a directory, a stem, or either file |
| `search_paths`     | `string[]`           | `[]`    | Extra directories, searched before the platform's own      |
| `auto_install`     | `bool`               | `false` | Fetch a missing pack without asking                        |

```yaml
engines:
  hunspell:
    enabled: true
    languages: ["he", "la"]
    dictionary_paths:
      la: /opt/dictionaries/latin
```

Dictionaries are not bundled — Hspell is AGPL-3.0 and the Latin pack is GPL, so
neither can ship inside an MIT binary. Install one with
`language-check packs install <lang>`, through your package manager, or by
naming an existing pair under `dictionary_paths`.

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
| `site`     | `merge` \| `ignore` \| `only` | `merge` | The site's own dictionary, in the browser extension |
| `add_to`   | `languagecheck` \| `site` \| a path | `languagecheck` | Where "Add to dictionary" puts a word |

```yaml
dictionaries:
  disabled: [companies]
  paths:
    - .languagecheck/project-terms.txt
```

### The site's own dictionary

In the browser extension, the site you write on keeps a dictionary of its own: Typst's personal dictionary, Overleaf's learned words. LangCheck reads it there each time it opens a project and uses it as one more wordlist, so a word you taught the site is not marked by LangCheck either. `site` chooses what becomes of it:

| Value    | Words accepted |
|----------|----------------|
| `merge`  | The site's and LangCheck's own (`dictionary.txt`) |
| `ignore` | LangCheck's own only |
| `only`   | The site's instead of LangCheck's `dictionary.txt`; "Add to dictionary" with the default `add_to` is then refused, since the word would change nothing (use `add_to: site` or a wordlist path) |

Bundled wordlists and `paths` apply in every case. The words are kept in `.languagecheck/site-dictionary.txt` in the workspace, and the config page shows on the `dictionaries` line (or its own status line) whether they arrived, how many there are, and how many entries were left out for not being single words.

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
ones you name and is ignored when `bundled` is false. An unrecognized name is
warned about in the server log and otherwise ignored, so a typo here never takes
the other wordlists down with it.

See `rust-core/dictionaries/THIRD_PARTY_NOTICES.md` for each list's source and
licensing.

### Where "Add to dictionary" puts a word

`add_to` names the dictionary that "Add to dictionary" writes to:

| Value | Where the word goes |
|-------|---------------------|
| `languagecheck` | LangCheck's own `.languagecheck/dictionary.txt` (the default) |
| `site` | The site's own dictionary, in the browser extension: Typst's personal dictionary or Overleaf's learned words, so the site stops marking the word too |
| a path | That wordlist file in the workspace, created with the first word; it is read as if it were listed in `paths` |

```yaml
dictionaries:
  add_to: .languagecheck/project-terms.txt
```

The word counts at once wherever it goes. Adding is refused, with the reason, where the word would change nothing: `languagecheck` under `site: only`, or `site` under `site: ignore` or where no site dictionary has arrived (VS Code). The config page marks `add_to` with where words go or why they cannot.

Typst keeps at most 100 words in a personal dictionary, and an open Typst tab writes all of its settings back on its next settings change: reload the Typst tab after adding words from LangCheck before you edit the dictionary in Typst itself.

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

## Morphology

One dictionary entry covers the words built on it. Adding `algebra` also accepts
`algebras`, `subalgebra`, `sub-algebra` and `algebraicity`, so the dictionary
stops growing one line per inflection. On by default.

| Field         | Type   | Default | Description                                            |
|---------------|--------|---------|--------------------------------------------------------|
| `enabled`     | `bool` | `true`  | Accept a flagged word that decomposes into a known root |
| `inflections` | `bool` | `true`  | Also accept the regular inflections of dictionary words |

```yaml
morphology:
  enabled: true
  inflections: true
```

Two switches because the two halves work differently, and can fail
differently.

### Prefixes and derivational suffixes are recognized

A word that is flagged as a misspelling is re-read as a productive prefix
(`sub-`, `semi-`, `non-`, `quasi-`, `counter-`, … — the full list is in
`rust-core/dictionaries/affixes/prefixes.txt`) and/or a derivational suffix
(`-ness`, `-ity`, `-able`, `-ly`, …) over a root. The root has to be a real
word — one of yours, one from a bundled list, or one Harper knows — so
`subalgebra` is accepted and `subxyzzy` is not. The closed and hyphenated
spellings take the same path, because Harper and LanguageTool disagree about
which one they report.

This is done by taking the word apart rather than by listing the results,
because prefixes stack freely: the set of words `algebra` licenses is
unbounded, so there is nothing to list.

### Inflections are generated

Plurals, and the past and progressive of `-ate`/`-ize`/`-ise`/`-ify` verbs, are
generated from each dictionary word when the workspace loads and then matched
like any other entry.

Generated, not stripped, because the spelling rules only run one way. `occur`
plus `-ed` is `occurred`; a checker that instead removed `-ed` from `occured`
would find `occur` and accept a misspelling. The same shape accepts `childs` and
`mouses`, which is why plurals are never recognized by taking a word apart.

### What keeps typos visible

A decomposition on its own is weak evidence: `untill` reads as `un-` + `till`,
and `till` really is a word. So the engine's own correction has the final say —
if it can offer something one edit away from what you typed, the squiggle stays.
A word with no plausible correction is what a genuine coinage looks like.

## Identifiers

Diagnostics inside an identifier-shaped token are dropped: `parse_json_blob`,
`MAX_RETRIES`, `getElementById`, `GitHub`. On by default.

| Field     | Type   | Default | Description                                                  |
|-----------|--------|---------|--------------------------------------------------------------|
| `enabled` | `bool` | `true`  | Drop diagnostics inside `snake_case` and `camelCase` tokens  |

```yaml
identifiers:
  enabled: true
```

Two shapes count. **snake** is an underscore between two letters or digits,
so the underscores of Markdown emphasis (`_teh_`) do not count and a typo
inside them is still reported. **camel** is a lowercase letter followed by an
uppercase one anywhere in the token. Hyphens do not count, because
`well-known` is English.

Every category is skipped, not only spelling. Harper and LanguageTool both
split on underscores, so for `parse_json_blob` they report `json` on its own,
and Harper reports it as a capitalization error. The flagged span is widened
to the whole token before its shape is checked.

A shift-key slip has the camel shape too: `tHe`. It stays visible when the
engine suggests the same word in another case, which Harper does.


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
| `shape`         | Capitalized away from the start of a sentence                      |

Requiring two signals is what keeps real misspellings visible. `Hoare` is suppressed
because it is a known surname *and* capitalized mid-sentence; `thier` is not, because
it is lowercase and sits one edit from `their`. Raising `aggressiveness` lowers that
bar and will eventually cost you real typos.

Capitalization is ignored as a signal for German (`de-*`), where every noun is
capitalized and the shape carries no information.

Use the **Names** tab in the Inspector to see exactly which words were suppressed and
which signals fired for each.
