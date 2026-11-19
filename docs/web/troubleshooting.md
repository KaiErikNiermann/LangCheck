# Troubleshooting the browser extension

:::{admonition} Beta
:class: note
The browser extension is in early development, so some of these problems are expected. If yours is not listed, please [report it](https://github.com/KaiErikNiermann/LangCheck/issues) with the browser, its version, the site and what the browser console shows.
:::

The extension logs to the browser's console with the prefix `[language-check]`. The page's messages are in the console of the site's tab, and the background's are in the extension's own console.

## Nothing is underlined

Run the host's own check first:

```sh
language-check-native-host doctor
```

It exits with an error and says what is wrong. The page shows one of three sentences when the host cannot start.

- "the browser has no LangCheck native host registered" means no manifest was found. Run `language-check-native-host install --browser firefox` (or `chrome`).
- "the registered LangCheck native host does not allow this extension" means the manifest names another extension. Run `install` again for this browser. For Chrome, pass `--chrome-extension-id` with the id shown on `chrome://extensions`.
- "the browser could not start the LangCheck native host, or it stopped at once" means the manifest exists but its binary did not run. `doctor` names the cause. A binary deleted by `cargo clean` is a common one, and Firefox reports it only as "An unexpected error occurred".

The page shows the sentence once per outage, as "LangCheck cannot reach its checker", and checks again by itself when the host answers. The extension waits longer between restarts the longer the host keeps failing, up to a minute.

`language-check-server` has to sit beside `language-check-native-host`. `doctor` reports it as missing when it does not.

## "LangCheck was reloaded, updated or turned off since this page opened"

The extension was reloaded while the page was open. Chrome leaves the old content script cut off. Reload the site tab. Firefox injects the new scripts into open tabs itself.

## Nothing is underlined on Notion or Gmail

Both sites need the CSS Custom Highlight API: Firefox 140 or later, Chrome 105 or later. In an older Firefox the extension does not attach, and the console says "this browser has no CSS Custom Highlight API".

## A document is not checked

- The text is over 4 MiB, or over 2 097 152 UTF-16 code units. A warning says so, and findings are hidden until the document is shorter.
- The document is excluded by the workspace config. Open the Inspector's Config tab to see how the config sorts the site's documents, or Edit Config to change `include`, `exclude` or `file_types`.
- On Gmail the text is in a quoted message or a signature, which are skipped.
- On Notion the text is in a code block, inline code or an equation, which are skipped.
- The "Check at most the first" option on the options page is set to something other than 0. Prose that starts past it is not checked.

## Two marks on one word

On Overleaf and Typst the site's own spellchecker marks the word too. The options page has a "show both" choice that leaves the site's marks alone. Choose "one mark per word", the default, to hide the site's marks and take its findings into LangCheck's. On Notion the browser's own underline can show beside LangCheck's, because Notion sets its `spellcheck` attribute back at once and the extension cannot switch the browser's checker off there.

## "Add to dictionary" is refused

The sentence says why. `dictionaries.add_to: languagecheck` is refused under `dictionaries.site: only`, and `add_to: site` is refused under `site: ignore` or when no site dictionary has arrived. Only Overleaf and Typst have a site dictionary. See the [dictionary settings](../reference/config-schema.md#dictionaries).

## A panel opens as a plain tab

SpeedFix and the Inspector open as the page's split-view partner only in Chrome 155 or later, and only when the browser accepts the split. Firefox and older Chrome versions open a plain tab beside the page.

## The palette shortcut does nothing

The palette opens on a real key press on the site's page. A shortcut that an editor or the browser uses, such as Ctrl+P, is refused on the options page. Check the shortcut there, and note that the default is Alt+Shift+P.

## Findings look wrong after the config changed

A saved config makes every page on the workspace check again. Configs are per workspace: Overleaf and Typst keep one per project, Notion one per workspace and Gmail one per account, so a config edited in one project does not apply to another.
