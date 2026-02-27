# CLI Reference

The `language-check` CLI provides standalone access to the checking engine.

## Usage

```bash
language-check [OPTIONS] <COMMAND>
```

## Commands

### `check`

Check files for prose issues.

```bash
language-check check [OPTIONS] <FILE>...
```

**Options:**

| Flag              | Description                               | Default |
|-------------------|-------------------------------------------|---------|
| `--config <PATH>` | Path to config file                      | Auto-detect |
| `--language <ID>` | Checking language (e.g., `en-US`)         | Auto-detect |
| `--format <FMT>`  | Output format: `text`, `json`, `sarif`   | `text`  |
| `--severity <LVL>`| Minimum severity: `error`, `warning`, `info`, `hint` | `hint` |

**Examples:**

```bash
# Check a single file
language-check check README.md

# Check with JSON output
language-check check --format json docs/*.md

# Check with specific language
language-check check --language de-DE brief.md
```

### `fix`

Auto-fix issues in files (applies suggestions with high confidence).

```bash
language-check fix [OPTIONS] <FILE>...
```

**Options:**

| Flag               | Description                              | Default |
|--------------------|------------------------------------------|---------|
| `--config <PATH>`  | Path to config file                     | Auto-detect |
| `--dry-run`        | Show changes without applying them      | `false` |
| `--min-confidence` | Minimum confidence for auto-fix (0.0-1.0)| `0.9`  |

### `workspace`

Check all supported files in a directory.

```bash
language-check workspace [OPTIONS] [PATH]
```

**Options:**

| Flag              | Description                               | Default |
|-------------------|-------------------------------------------|---------|
| `--config <PATH>` | Path to config file                      | Auto-detect |
| `--format <FMT>`  | Output format                            | `text`  |
| `--jobs <N>`      | Number of parallel workers               | CPU count |

## Exit Codes

| Code | Meaning                    |
|------|----------------------------|
| 0    | No issues found            |
| 1    | Issues found               |
| 2    | Configuration or I/O error |
