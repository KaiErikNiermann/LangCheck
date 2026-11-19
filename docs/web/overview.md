# Browser extension overview

:::{admonition} Beta
:class: note
The browser extension is in early development. It can only be installed as a development build for now, and its behavior and settings may change between versions. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

LangCheck for web editors is a browser extension that checks the prose you write in a web editor with the same core that VS Code uses. The core runs on your machine as a separate program that the browser starts through a native messaging host, so the text you check does not go to a LangCheck server.

The extension reuses the VS Code client's checking code behind a stand-in for the `vscode` API. Findings, fixes, SpeedFix, the Inspector and the config view behave as they do in VS Code, and the checking, caching, dictionaries and suppression come from the same `language-check-server`. See [how it fits together](architecture.md) for the pipeline.

## Supported sites

The extension runs on four sites.

- Overleaf (`www.overleaf.com`, pages under `/project/`): the open file, read as LaTeX, BibTeX, Markdown or plain text by its extension (LaTeX when neither the extension nor the editor says otherwise).
- Typst (`typst.app`, pages under `/project/`): the open Typst file.
- Notion (`app.notion.com` and `www.notion.so`): the prose of the open page.
- Gmail (`mail.google.com`, pages under `/mail/`): the message you are writing.

What each site checks, and what it leaves out, is on [the sites page](sites.md).

## Browser requirements

The extension needs Firefox 128 or later, or Chrome 128 or later. Notion and Gmail also need the CSS Custom Highlight API, which is in Firefox 140 or later and Chrome 105 or later. A browser without it gets no checking on those two sites. The reason is logged to the browser console.

The end-to-end tests that drive the whole path run in Chromium only, because Playwright cannot load an extension into Firefox. In October 2026 the release build was also loaded by hand in Firefox 155 and checked on the four live sites.

## What it does

- Underlines findings in the editor and opens a card with fixes on hover or with Ctrl+. (Cmd+. on a Mac).
- Shows the top suggestion as ghost text after a finding on Overleaf and Typst.
- Opens a command palette over the page with Alt+Shift+P.
- Opens the SpeedFix and Inspector panels in a browser tab beside the page.
- Edits the config for the project in a config tab.
- Takes the site's own spellchecker and dictionary into account on Overleaf and Typst.

[Using the extension](usage.md) describes each of these.

## Where to go next

- [Installing](installation.md) the extension, the native host and the core.
- [Using the extension](usage.md) once it is running.
- [Settings](settings.md) on the options page and in the project config.
- [Privacy and trust](privacy.md) for what leaves the page and what the host may do.
- [Troubleshooting](troubleshooting.md) when nothing is underlined.
- [Architecture](architecture.md) and [development](development.md) for contributors.
