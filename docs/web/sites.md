# Supported sites

:::{admonition} Beta
:class: note
Site support is in early development, and a site that changes its editor can stop working until the extension catches up. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

Each site below is a project or account the core keeps a workspace for. A workspace has its own config, its own learned words and its own copy of the site's dictionary. The workspace key is the site and the project (`overleaf-<project id>`), so two projects never share a config.

## Overleaf

- Runs on `https://www.overleaf.com/project/*`, in the source editor, which is a CodeMirror 6 editor.
- Checks the open file only. Other files of the project are checked when you open them.
- The language comes from the file's extension: `tex`, `sty`, `cls` and `ltx` are LaTeX, `bib` is BibTeX, `md` is Markdown and `txt` is plain text. Otherwise it comes from the language CodeMirror reports, and LaTeX is the default.
- Has inline hints, the site's own dictionary and the site's own spellchecker. See [settings](settings.md#site-spellchecker-and-dictionary).
- A document's path is its place in the file tree, so `include`, `exclude` and `file_types` match it like a file.

Overleaf's own spellchecker checks text lazily as it scrolls into view and keeps its marks (measured on a 256 KB document on 2026-10-14). Under the default `merge` mode, its findings reach LangCheck only for text it has checked, while LangCheck checks the whole document itself.

## Typst

- Runs on `https://typst.app/project/*`.
- Checks the open file. The default language is Typst, and the editor's language wins when it reports another, such as a `.bib` file.
- Has inline hints, the site's own dictionary and the site's own spellchecker.
- A document's path is its name in the project, read from the project's file list.
- Typst keeps at most 100 words in a personal dictionary. With `dictionaries.add_to: site` the extension writes to it as the site does, and a Typst tab that was already open can write its own settings back later and drop a word added from LangCheck. Reload the Typst tab after adding words from LangCheck.

## Notion

- Runs on `https://app.notion.com/*` and `https://www.notion.so/*`. The workspace is the workspace named in the page's URL. A bare page URL belongs to a default workspace.
- Checks the prose of the open page, including a page shown in a side or centre peek, read as Markdown. Notion text is in ordinary text blocks, so headings, lists, quotes, to-dos, callouts and toggles are all checked, and so is the page title.
- Does not check code blocks, inline code or equations. Mentions and dates count as a placeholder character and are skipped.
- Has no inline hints. The card shows the suggestion.
- Needs the CSS Custom Highlight API: Firefox 140 or later, Chrome 105 or later.
- Has no dictionary of its own to read. Notion also sets its `spellcheck` attribute back at once, so the browser's own underline can show beside LangCheck's marks.
- A page's path is its breadcrumb with `.md` added, such as `University Courses/Logical Verification.md`, so `exclude: ["Journal/**"]` leaves every page under Journal unchecked. Notion shortens a long breadcrumb to its first and last crumbs with `…` between, and the path is the shortened one it shows. A page opened in a peek sits under the page it opened over. Only pages you have opened are known, since Notion gives no page list.

## Gmail

- Runs on `https://mail.google.com/mail/*`. The workspace is the signed-in account named in the URL (`/mail/u/<n>/`), so each account has its own dictionary.
- Checks the body of the compose you are writing in, as Markdown. The quoted message in a reply, the signature and smart chips are skipped. The small and full-screen compose are one element at two sizes, so findings stay when you switch.
- Has no inline hints and no site dictionary.
- Has no files, so `include`, `exclude` and `file_types` do not apply and Exclude Current File says so and changes nothing.
- While findings are merged or LangCheck's alone, the browser's own spellchecker is switched off on the body and put back after.
- Needs the CSS Custom Highlight API.

## Other sites

A site is a few facts about where its editor is and what the open document is called. Adding one is a change to the extension, not a setting. See [adding a site](development.md#adding-a-site).
