# Using the browser extension

:::{admonition} Beta
:class: note
The browser extension is in early development, and what is described here may change between versions. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

Once the extension is [installed](installation.md), open a project on a supported site. The extension starts on its own and checks the open document.

## Findings and the fix card

A check runs when a document opens and again about half a second after you stop typing. Findings are underlined in the editor. Rest the pointer on a finding for 0.3 seconds and a card opens under it. Press Ctrl+. (Cmd+. on a Mac) to open the card for the finding at the cursor, and Escape to close it.

The card lists the fixes the core suggests, with the top suggestion first, and the other actions the VS Code client offers on a finding, such as adding the word to the dictionary or ignoring the finding. A fix replaces the text the finding covers. If the text changed since the check, the fix is refused instead of landing on the wrong words.

Any edit closes the card, since what it offers was computed for the old text.

## Inline hints

On Overleaf and Typst the top suggestion is also shown as ghost text after the finding, as VS Code shows an inlay hint. Ctrl+click (Cmd+click on a Mac) on the ghost text applies it. Notion and Gmail show no hints, because the CSS highlights that mark findings there can only style text that already exists. The suggestion is in the card instead.

The options page chooses when the hints show, with the same four choices as VS Code's `editor.inlayHints.enabled`. In the two modes with "unless pressed", holding Ctrl+Alt flips the hints. See [settings](settings.md#suggestion-hints).

## The command palette

Alt+Shift+P opens a palette over the page. It lists five commands under the VS Code titles, without the "Language Check:" prefix.

- Check Current Document
- Open SpeedFix
- Open Inspector
- Edit Config
- Exclude Current File from Checking

A "Palette Theme…" entry in the same list sets the palette's theme: the system's, light or dark. The shortcut is changed on the options page. The palette opens only on a real key press, not on a key event a script sends.

## SpeedFix and the Inspector

SpeedFix and the Inspector are the VS Code client's own panels. Each opens in a browser tab beside the page. In Chrome 155 and later the first panel opens as the page's split-view partner, as VS Code opens a panel beside the editor. Where the browser refuses a split, and in Firefox, it opens as a plain tab. A page can have one panel of each kind.

The Inspector's Config tab shows which config is in force, what it includes, and how it sorts the site's documents. On Gmail it says the file lists do not apply, because a message has no file. On Notion it lists the pages opened so far, because Notion gives no list of its pages to read.

## Edit Config

Edit Config opens the config of the current workspace in a tab. The editor draws gutter marks and squiggles for each key as VS Code does. The config is saved about a second after you stop typing. The core then reads it again and every page on the same workspace checks again under it.

The workspace is the project on Overleaf and Typst, the workspace on Notion, and the account on Gmail. It is not the config of any project in VS Code. The file is `.languagecheck.yaml` in the workspace's directory, and a workspace that has no config file uses the defaults. The keys are those in the [configuration guide](../guide/configuration.md) and the [schema reference](../reference/config-schema.md), with the limits listed in [settings](settings.md#what-a-workspace-config-may-not-do).

## Exclude Current File

Exclude Current File from Checking adds the open document to the workspace config's `exclude` list and checks again. A document's path is its place in the project: the file path on Overleaf and Typst, and the breadcrumb on Notion, for example `Journal/Monday.md`. Gmail has no files, so the command says so and changes nothing.

Because each check sends the document's path, the config's `include`, `exclude` and `file_types` apply on the web as they do to files in VS Code.

## Adding words

"Add to dictionary" writes the word where the config's `dictionaries.add_to` says. The default is the workspace's own `.languagecheck/dictionary.txt`. On Overleaf and Typst, `add_to: site` writes the word into the site's own dictionary instead. See [the site spellchecker and dictionary](settings.md#site-spellchecker-and-dictionary).

## Long documents

A check carries at most 4 MiB of UTF-8 text, and at most 2 097 152 UTF-16 code units. Past either limit the document is not checked and a warning says so. The options page also has a [progressive check](settings.md#long-documents) that shows the part in view first.
