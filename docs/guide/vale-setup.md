# Vale Setup

[Vale](https://vale.sh/) is a syntax-aware prose linter with a rich plugin
ecosystem. Language Check integrates Vale as a first-class engine alongside
Harper and LanguageTool.

## Installing Vale

::::{tab-set}

:::{tab-item} Homebrew (macOS/Linux)
```bash
brew install vale
```
:::

:::{tab-item} Scoop (Windows)
```powershell
scoop install vale
```
:::

:::{tab-item} Binary download
Download from [GitHub Releases](https://github.com/errata-ai/vale/releases)
and place `vale` on your `$PATH`.
:::

::::

Verify with:

```bash
vale --version
```

## Enabling Vale

Add `vale: true` to your `.languagecheck.yaml`:

```yaml
engines:
  harper: true
  vale: true
```

Or use the **Language Check: Toggle Vale** command from the VS Code command
palette.

## Vale Configuration

Vale uses its own `.vale.ini` config file for styles, packages, and
per-glob settings. Language Check does **not** replace this — you manage
Vale's config separately and Language Check invokes Vale with it.

### Minimal `.vale.ini`

```ini
StylesPath = styles
MinAlertLevel = suggestion
Packages = Google

[*]
BasedOnStyles = Vale, Google
```

After creating the config, run:

```bash
vale sync
```

This downloads the packages listed in `Packages` into the `StylesPath`
directory.

### Pointing to a custom config

If your `.vale.ini` is not in the workspace root, specify the path:

```yaml
engines:
  vale: true
  vale_config: "config/.vale.ini"
```

When omitted, Vale uses its own config search logic (current directory
upward, then the global config).

## Style Packages

Vale's [style explorer](https://vale.sh/explorer) offers curated packages:

| Package     | Focus                            |
|-------------|----------------------------------|
| Google      | Google developer documentation   |
| Microsoft   | Microsoft writing guidelines     |
| write-good  | English prose (weasel words, passive voice) |
| proselint   | General prose advice             |
| Readability | Flesch-Kincaid, Gunning Fog, etc. |
| alex        | Inclusive, considerate writing   |

Enable packages in `.vale.ini`:

```ini
Packages = Google, write-good, proselint

[*]
BasedOnStyles = Vale, Google, write-good, proselint
```

## How it Works

Language Check sends document text to Vale via stdin with:

```
vale --output=JSON --no-exit --ext=.md [--config=<path>]
```

Vale's JSON output is parsed and converted to Language Check diagnostics:

| Vale field       | Language Check mapping         |
|------------------|-------------------------------|
| `Severity: "error"` | Error severity             |
| `Severity: "warning"` | Warning severity         |
| `Severity: "suggestion"` | Hint severity         |
| `Check`          | Rule ID prefixed with `vale.` |
| `Action.Params`  | Fix suggestions               |
| `Line` + `Span`  | Byte offsets                  |

## Rule Overrides

Override Vale rule severities in `.languagecheck.yaml` using the
`vale.<Style>.<Rule>` format:

```yaml
rules:
  vale.Google.We:
    severity: "off"       # Disable this rule
  vale.Vale.Spelling:
    severity: warning     # Downgrade from error
```

## High Performance Mode

Vale is skipped when `performance.high_performance_mode` is enabled,
since it requires spawning an external process.
