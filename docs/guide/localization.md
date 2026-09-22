# Contributing Translations

Translations live in the repository next to the code and are contributed by pull request, the same as any other change. There is no translation platform to sign up for.

There are two independent sets of files: the VS Code extension, which uses flat JSON, and the documentation, which uses gettext `.po` catalogs. Pick whichever you want to work on — they do not depend on each other.

## How to contribute

1. Fork the repository and branch off `main`.
2. Edit the files described below.
3. Run `just check-l10n` to verify the extension files are still in sync.
4. Open a pull request.

Partial work is fine. For the documentation, leave `msgstr ""` on anything you have not translated and Sphinx falls back to English. For the extension, every key must be present (see [CI Checks](#ci-checks)), so copy the English string as the value for any key you skip.

## Extension Localization

The VS Code extension has two sets of translatable files:

### Runtime strings (`extension/l10n/`)

These are user-facing messages shown in notifications, the status bar, SpeedFix panel, and dialogs.

| File | Purpose |
|------|---------|
| `bundle.l10n.json` | English source strings |
| `bundle.l10n.de.json` | German translations |
| `bundle.l10n.es.json` | Spanish translations |
| `bundle.l10n.fr.json` | French translations |

Format: flat JSON with the English string as both key and value in the base file.

```json
{
  "Checking workspace...": "Arbeitsbereich wird geprüft..."
}
```

Placeholders like `{0}` must be preserved in translations — they are replaced at runtime with dynamic values.

### UI metadata strings (`extension/package.nls.*.json`)

These define command palette names, configuration descriptions, and walkthrough content.

| File | Purpose |
|------|---------|
| `package.nls.json` | English source strings |
| `package.nls.de.json` | German translations |
| `package.nls.es.json` | Spanish translations |
| `package.nls.fr.json` | French translations |

Format: flat JSON with dot-notation keys.

```json
{
  "command.checkDocument": "Language Check: Aktuelles Dokument prüfen",
  "config.check.trigger": "Wann Dokumentprüfungen ausgelöst werden sollen."
}
```

### Adding a new language

To add a new language for the extension:

1. Copy `extension/l10n/bundle.l10n.json` to `extension/l10n/bundle.l10n.<locale>.json`
2. Copy `extension/package.nls.json` to `extension/package.nls.<locale>.json`
3. Translate all values (keep keys unchanged)
4. Use [BCP 47](https://www.ietf.org/rfc/bcp/bcp47.txt) locale codes: `de`, `fr`, `ja`, `pt-BR`, `zh-CN`, etc.

### Testing locally

Set VS Code's display language to test your translations:

```
Ctrl+Shift+P -> Configure Display Language -> select your locale
```

Or launch with a locale flag:

```sh
code --locale=de
```

## Documentation Localization

The documentation uses [Sphinx](https://www.sphinx-doc.org/) with gettext for internationalization.

### How it works

1. Source `.md` files are written in English
2. `sphinx-build -b gettext` extracts translatable strings into `.pot` template files
3. `sphinx-intl` generates `.po` files for each target language
4. Translators fill in `msgstr` entries in the `.po` files
5. Sphinx builds the translated documentation from the `.po` files

### File structure

```
docs/locale/
├── es/LC_MESSAGES/
│   ├── index.po
│   ├── guide/
│   │   ├── installation.po
│   │   └── configuration.po
│   └── reference/
│       └── cli.po
├── fr/LC_MESSAGES/
│   └── ...
└── ja/LC_MESSAGES/
    └── ...
```

### Translating .po files

Each `.po` file contains message pairs:

```po
#: ../../guide/installation.md:5
msgid "Install the extension from the VS Code Marketplace."
msgstr ""
```

Fill in the `msgstr` with your translation:

```po
msgstr "Installez l'extension depuis le VS Code Marketplace."
```

**Tips:**

- Leave `msgstr ""` empty for untranslated strings (Sphinx falls back to English)
- Do not translate code blocks, command names, or file paths
- Preserve reStructuredText/MyST markup (links, admonitions, code references)
- Remove the `#, fuzzy` flag after reviewing a machine-suggested translation

### Local preview

To preview translated docs locally:

```sh
# Regenerate .po files after source changes
just docs-intl-update

# Build docs in a specific language
just docs-lang fr

# Open the result
open docs/_build/html/fr/index.html
```

### Adding a new language

1. Add the language code to the `languages` list in `docs/conf.py`
2. Generate `.po` files: `just docs-intl-update` (add `-l <code>` to the `sphinx-intl` command in the Justfile)
3. Translate the `.po` files
4. Submit a PR

## CI Checks

A CI job verifies that every extension translation file has exactly the same keys as its English base, and that each file is valid JSON. A missing or extra key fails the build.

So if you add a new translatable string to the extension, add that key to every existing translation file in the same pull request. Use the English string as the value where you cannot translate it. A later pull request can replace it.

Run the check locally:

```sh
just check-l10n
```

## Current Languages

| Language | Extension | Docs |
|----------|-----------|------|
| English | Base | Base |
| German (de) | Complete | Not started |
| Spanish (es) | Complete | Not started |
| French (fr) | Complete | Not started |
| Japanese (ja) | — | Not started |
