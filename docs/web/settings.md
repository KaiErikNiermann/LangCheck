# Browser extension settings

:::{admonition} Beta
:class: note
These settings are in early development and may change between versions. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

The extension has two kinds of settings. The options page holds what belongs to the browser and applies to every site. The config of a workspace, edited with Edit Config, holds what belongs to a project and uses the same keys as `.languagecheck.yaml` in VS Code.

## The options page

Open the extension's options page from the browser's extensions page. A page that is already open picks up a saved checking option at its next check.

### Palette shortcut and theme

The shortcut opens the command palette. It is written in hotkeys-js notation, for example `alt+shift+p`, `ctrl+shift+l` or `alt+k`. Leaving it empty restores the default, `alt+shift+p`. A shortcut needs Ctrl, Alt or Cmd (or is a function key), and the page refuses one that an editor or the browser uses, such as Ctrl+C, Ctrl+S or Ctrl+P.

The palette theme is system (follow the browser), light or dark. It is saved as soon as you choose it, and the palette's own "Palette Theme…" entry sets the same value.

### Long documents

These options are the web's form of the client's `languageCheck.check.progressive`, `languageCheck.check.windowBytes` and `languageCheck.check.maxBytes` settings.

- Progressive check, off by default. A document's first check is made a window at a time, the window with the cursor or the top of the view first, and findings show as each window lands. Later checks are whole, because the core keeps what it found.
- Window size, 16 KiB by default, from 1 KiB to 1024 KiB.
- Check at most the first this many KiB, 0 by default, which means all of the document. Prose that starts past the limit is not checked.

An edit stops the windows, and the document's next check starts over in windows. The [benchmarks](../reference/benchmarks.md) report what a progressive check of 1 MB of LaTeX costs.

### Site spellchecker and dictionary

Overleaf and Typst mark misspellings themselves, and the browser can too. The options page chooses what happens where they mark the words LangCheck checks.

- "Show one mark per word", the default. The site's marks are hidden and what the site found goes to the core as one more engine's findings, so the dictionary, ignores and your rules apply to them.
- "Show only LangCheck's" hides the site's marks and ignores what they found.
- "Show both" shows the site's marks as well as LangCheck's.

On Gmail the browser's own spellchecker cannot be read, so the first two choices both switch it off on the message body and put it back afterwards. On Notion the site sets the attribute back at once, so the browser's underline can still show.

Overleaf and Typst also keep a dictionary of words you taught them. LangCheck reads it in the page each time the project opens and when it may have changed, and uses it as one more wordlist, so a word you taught the site is not marked by LangCheck either. The project's config chooses what becomes of it with `dictionaries.site`, and where "Add to dictionary" writes with `dictionaries.add_to`. Both are described in the [configuration schema](../reference/config-schema.md#dictionaries). The words are kept in `.languagecheck/site-dictionary.txt` in the workspace, and the config view shows how many arrived.

### Suggestion hints

The top suggestion is shown as ghost text after a finding on Overleaf and Typst. The setting follows VS Code's `editor.inlayHints.enabled`.

- Shown, the default.
- Shown, hidden while Ctrl+Alt is held.
- Hidden, shown while Ctrl+Alt is held.
- Hidden.

Ctrl+click (Cmd+click on a Mac) on a shown hint applies it.

## The workspace config

Edit Config opens the config for the current project, account or workspace. The keys are those of the [configuration guide](../guide/configuration.md) and the [schema reference](../reference/config-schema.md): engines, rules, dictionaries, `include`, `exclude`, `file_types` and the rest. Three of them matter most on the web.

- `include`, `exclude` and `file_types` match a document's path in the project, as described for each [site](sites.md).
- `dictionaries.site` is `merge` (the default), `ignore` or `only`.
- `dictionaries.add_to` is `languagecheck` (the default), `site` or the path of a wordlist file inside the workspace.

### What a workspace config may not do

The native host refuses to write or probe a config that would let a browser start programs or reach files outside the workspace. A config with any of these is refused, and the host's answer names the key.

- `engines.external`, which runs programs.
- `engines.wasm_plugins`, which loads code.
- `workspace.db_path`, which chooses where the core writes.
- A path-valued key that names a file outside the workspace: an absolute path, one starting with `~`, or one that uses `..`.

Enabling an engine that talks to a server, such as LanguageTool with its URL, is allowed.
