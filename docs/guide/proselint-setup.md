# Proselint Setup

[Proselint](https://github.com/amperser/proselint) is a linter for English
prose that checks for common style and usage errors. Language Check integrates
Proselint as an optional engine alongside Harper, LanguageTool, and Vale.

:::{note}
Proselint only supports **English**. It is automatically skipped when
`spell_language` is set to a non-English locale.
:::

## Installing Proselint

Proselint is a Python package. Install it so the `proselint` binary is on
your `$PATH`.

::::{tab-set}

:::{tab-item} pip
```bash
pip install proselint
```
:::

:::{tab-item} pipx (recommended)
```bash
pipx install proselint
```

pipx installs into an isolated environment and adds the binary to your PATH
automatically.
:::

:::{tab-item} Homebrew (macOS/Linux)
```bash
brew install proselint
```
:::

:::{tab-item} System package
```bash
# Debian/Ubuntu
sudo apt install python3-proselint

# Arch Linux
sudo pacman -S proselint
```
:::

::::

Verify with:

```bash
proselint --version
```

:::{tip}
If the command is not found after installing, ensure the install location
is on your `$PATH`. For pip, this is typically `~/.local/bin` on Linux/macOS
or `%APPDATA%\Python\Scripts` on Windows. You may need to add it:

```bash
# Linux/macOS — add to ~/.bashrc or ~/.zshrc
export PATH="$HOME/.local/bin:$PATH"
```
:::

## Enabling Proselint

Add `proselint: true` to your `.languagecheck.yaml`:

```yaml
engines:
  harper: true
  proselint: true
```

Or use the **Language Check: Manage Engines** command from the VS Code
command palette.

The inspector health tab shows whether the `proselint` binary was detected
and will display install instructions if it is missing.

## Proselint Configuration

Proselint uses its own JSON config file. Language Check does **not** replace
this — you manage Proselint's config separately.

### Config search order

Proselint searches for configuration in this order:

1. `proselint.json` in the current directory (and parents)
2. `~/.config/proselint/config.json`

### Pointing to a custom config

Specify a custom config path in `.languagecheck.yaml`:

```yaml
engines:
  proselint:
    enabled: true
    config: "config/proselint.json"
```

### Example config

```json
{
  "checks": {
    "typography.diacritical_marks": false,
    "misc.suddenly": false
  }
}
```

See the [Proselint README](https://github.com/amperser/proselint) for the
full list of available checks.

## How it Works

Language Check sends document text to Proselint via stdin with:

```
proselint check -o json [--config <path>]
```

Proselint's JSON output is parsed and converted to Language Check diagnostics:

| Proselint field   | Language Check mapping              |
|-------------------|-------------------------------------|
| `check_path`      | Rule ID prefixed with `proselint.`  |
| `message`         | Diagnostic message                  |
| `span`            | Byte offsets (adjusted for padding) |
| `replacements`    | Fix suggestions                     |

All Proselint diagnostics are mapped to **warning** severity.

## Rule Overrides

Override Proselint rule severities in `.languagecheck.yaml` using the
`proselint.<check_path>` format:

```yaml
rules:
  proselint.uncomparables:
    severity: "off"       # Disable this rule
  proselint.hedging:
    severity: info         # Downgrade from warning
```

## High Performance Mode

Proselint is skipped when `performance.high_performance_mode` is enabled,
since it requires spawning an external process.
