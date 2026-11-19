# Browser extension architecture

:::{admonition} Beta
:class: note
The browser extension is in early development, and its internals change often. This page describes the code in `web/` and the core as they are now. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

The extension is the VS Code client's checking path behind a stand-in for the `vscode` module. The code that turns the core's findings into squiggles, fixes and hints is the code VS Code runs, and a site adds only a few facts about where its editor is. Paths below are relative to the repository root.

## The pipeline

```
page world        shim, the client's feature code and an editor adapter,
                  in the site's own realm, joined to the site's editor
   | MessagePort
content script    validates each request and relays it
   | runtime port
background        one native connection per workspace, with backoff
   | native messaging
native host       language-check-native-host
   | stdin/stdout
core              language-check-server
```

### The page world

`web/src/page/startPage.ts` runs in the site's own JavaScript realm, as a content script with `world: "MAIN"`. It has to run there because it needs the editor's live objects: Overleaf's CodeMirror view, for one, is reachable only from the page's realm, and the page's content security policy blocks code injected as a string. It shares the realm with the site's scripts, and anything it sends is untrusted.

`startPage` finds the workspace from the page's URL and follows the URL, because Notion moves between pages and workspaces without a load. For each workspace it builds the client (`web/src/page/client.ts`), a `Bridge` that keeps the site's editor joined, and a connection to the content script.

The page sends a window message of type `language-check:page-ready`. The content script answers with a message of type `language-check:port` that carries a private `MessagePort`. Requests and responses travel over that port.

### The content script

`web/src/content/content.ts` runs in the extension's isolated world. It parses every page request with `parsePageRequest` and relays only what it accepts to the background over a runtime port. A tab can hold at most four page ports, and a page at most eight requests in flight. It also owns the command palette (an extension-page iframe over the site, `web/src/palette/`), reads the checking settings from `browser.storage.local`, and forwards panel messages. The workspace is never the page's to choose: the background derives it from the tab's URL.

### The background

`web/src/background/background.ts` is a service worker in Chrome and an event page in Firefox. It does five jobs.

- Keeps one native connection per workspace key (`web/src/background/nativeCore.ts`), through `connectNative("language_check")`. A request times out after 60 seconds, at most 32 wait per connection, and at most four connections stay open. Idle connections close after ten minutes. After two timeouts in a row the connection is dropped so the next request starts a fresh host. Reconnecting backs off from one second to one minute while the host keeps failing.
- Takes each request's workspace from the sender tab's URL with `workspaceForUrl` (`web/src/sites/registry.ts`).
- Opens panels (`panels.ts`) and config tabs (`configTabs.ts`), within one budget of ten tabs a minute for each source tab (`openBudget.ts`).
- Opens a panel as the page's split-view partner where the browser can (`splitTabs.ts`).
- Edits the config for Exclude Current File (`excludeDocument.ts`), one workspace at a time.

### The native host

`rust-core/src/native_host.rs` and `rust-core/src/bin/language-check-native-host.rs`. A browser message is `{"frame": "<base64 Request>"}`. A response goes back as one or more `{"frame": ..., "more": bool}` messages of at most 768 KiB of base64, because a browser takes at most 1 MiB from a host. The host decodes each request and admits only what a web document needs. It strips `file_path`, `db_path` and `dictionaries_paths`. It turns the workspace into a key under its data directory and caps the text at 4 MiB. Config requests are answered only within the confinement in [settings](settings.md#what-a-workspace-config-may-not-do). The host starts `language-check-server` from its own directory. It ends the server when the browser closes the port, and exits when the server does.

The same binary has two subcommands. `install --browser <firefox|chrome|chromium>` writes the host manifest. `doctor` reads each browser's manifest as the browser would and says whether the host it names can start.

### The core

The server is unchanged. Checking, caching, dictionaries and suppression are the same code as in VS Code. The web uses these requests and fields, listed in `proto/checker.proto`:

- `CheckRequest.window`, a byte window, so a long document's first check can be made a window at a time. The server extracts and describes every range and sends the engines only the ranges whose first byte is in the window (`rust-core/src/prose/window.rs`). A windowed answer is never stored as the document's result.
- `CheckRequest.foreign`, what the site's own spellchecker found in the same text. See [foreign checkers](#foreign-checkers-and-site-dictionaries).
- `CheckRequest.document_path`, where a document sits in its workspace when it has no file on disk. It is matched against `include`, `exclude` and `file_types` as `file_path` is, and used for nothing else.
- `SiteDictionaryRequest` and `SiteWriteResponse`, for the site's own dictionary.
- `ReadConfig`, `WriteConfig` and `ProbeConfig`, which only the extension's config tab may send. `ReadConfig` and `WriteConfig` name the config by file name, never a path, and cap it at 256 KiB. A write is staged through a temporary file that is created new and renamed over the config.
- `ListConfigFilesRequest.documents`, a list of document paths to sort in place of walking a directory. The Inspector's Config tab uses it.
- `ErrorResponse.for_page`, which the core sets on an error it wrote for the person at the editor. The background passes that message on as it is. Every other error reaches the page as a fixed sentence per error code, because core errors can name local paths.

## Messages and validation

`web/src/messaging/protocol.ts` defines what a page may ask. `parsePageRequest` accepts exactly one known payload and rebuilds it from the fields it may carry. Fields the client's `Checker` sends but a page may not, such as `filePath` and `settings`, are dropped. A new field on `CheckRequest` is dropped on its way to the core until `parseCheckProse` parses it, and the page's check silently loses it. To add one, extend the `CoreRequest` type and the parser in `protocol.ts`, check what `admit` in `native_host.rs` does with it, and cover it in `web/test/unit/protocol.test.ts`.

The limits, with where each is defined:

| Limit | Value | Defined in |
| --- | --- | --- |
| Text of a check | 2 Mi UTF-16 units and 4 MiB of UTF-8 | `MAX_CHECK_TEXT_CHARS` and `MAX_CHECK_TEXT_BYTES` in `protocol.ts`, `MAX_CHECK_TEXT_BYTES` in `native_host.rs` |
| Foreign findings and a site dictionary sent with one request | 512 KiB | `EXTRAS_BUDGET_BYTES` in `protocol.ts` |
| Foreign findings in one check | 10 000 | `MAX_FOREIGN_FINDINGS` in `protocol.ts`, `MAX_FINDINGS` in `foreign.rs` |
| Words taken from a site dictionary | 10 000, each at most 64 characters | `MAX_SITE_DICTIONARY_WORDS` in `protocol.ts`, `MAX_WORDS` and `MAX_WORD_CHARS` in `site_dictionary.rs` |
| A document path | 1024 bytes | `MAX_DOCUMENT_PATH_BYTES` in `protocol.ts` and `selection.rs` |
| Documents in a listing | 10 000 | `MAX_LISTED_DOCUMENTS` in `protocol.ts` and `native_host.rs` |
| One browser message to the host | 8 MiB | `MAX_BROWSER_MESSAGE_BYTES` in `native_host.rs` |

A response to a page is a `PageResponse`: either `ok` with the protobuf `Response` as plain data, or a failure with a code from `unavailable`, `interrupted`, `refused`, `busy`, `timeout` and `failed`. `unavailable` means the host is not installed or keeps dying, and the page reports it once instead of on every keystroke. `interrupted` means the request was cut off and the page checks again when it reconnects. `PROTOCOL_VERSION` is bumped on any incompatible change, and the page and content script must agree.

## Reusing the VS Code client

`web/esbuild.mjs` aliases the module `vscode` to `web/src/shim/vscode.ts`, so the client's feature code runs unchanged. The shim implements the parts of the API the checking path uses: documents and text, diagnostics, code actions, commands, inlay hints, hover providers, a webview host and the Uri and Range value classes. Any namespace member it does not implement resolves to a logged no-op instead of an exception. `path` in the client's modules is `path-browserify`.

`web/src/page/client.ts` is the composition root. It wires the client's own `Checker`, `DiagnosticStore`, `CheckResults`, `InspectorLog`, code actions, command handlers, SpeedFix panel and Inspector panel to a transport that talks to the content script (`web/src/page/transport.ts`) instead of to a core process over stdio. What is web-only is the wiring. The web registers a subset of the client's commands, listed in `WEB_COMMANDS`. A check runs when a document opens and 500 ms after the last edit. `focusOf` tells a progressive check where the user is in the page's editor, and `foreignOf` supplies the site checker's findings.

The command palette takes its commands and their titles from the client: ids from `extension/src/generated/meta.ts` and titles from `extension/package.nls.json`, so the palette reads like VS Code's. A command is added to the palette's list (`web/src/palette/commands.ts`) when the web gains it.

What must behave the same in VS Code and in the browser is written once, beside the VS Code UI tests, and both hosts run it. See [development](development.md#testing).

## Editor adapters

An `EditorAdapter` (`web/src/editor/types.ts`) is what a concrete editor gives the shim. It deals only in document offsets, which are UTF-16 code units, and the shim keeps all line and character bookkeeping. An adapter draws findings and applies text edits. It also supplies the card's action source and reports edits and pointer positions. A site's `EditorHandle` (`web/src/editor/handle.ts`) names the editor's identity, the document's name, its language, optionally its path in the project, and an `attach` function. The `Bridge` (`web/src/page/bridge.ts`) compares those identities every 500 ms and attaches again when the editor was remounted, the document switched, or the extension lost.

### CodeMirror 6

Overleaf and Typst run CodeMirror 6, and `web/src/editor/cm6Adapter.ts` joins the page's own editor. CodeMirror checks class identity (`effect.is(type)`, `state.field(field)`), so a bundled second copy of `@codemirror/state` cannot talk to the page's editor. `web/src/editor/cm6kit.ts` finds each class by shape in the running editor: `EditorView`, `StateEffect`, `StateField`, `Decoration` and `Compartment`. Discovery prefers public API and uses internals only where CodeMirror offers none. Each candidate's shape is checked before use, and a miss is reported by name. A CodeMirror upgrade on a site then degrades to "not attached: StateField not found" instead of to misbehavior. The adapter's extension is installed into its own `Compartment`, so detaching removes it. The build fails if a bundled CodeMirror reaches a page bundle.

CodeMirror 6.39 rewrote the view's internals, and `.cm-content` carries `cmTile.root.view` from then on instead of `cmView.view`. `viewFromContentDom` reads both. The end-to-end stand-ins for Overleaf and Typst are built against CodeMirror 6.43 and 6.38, one on each side of the change.

### The DOM adapter

Notion and Gmail are `contenteditable` editors, and `web/src/editor/domAdapter.ts` serves both. It paints findings with the CSS Custom Highlight API: live DOM ranges in a `Highlight`, styled with `::highlight()`. Nothing in the editor's DOM changes, so nothing fights the site's renderer. A range over replaced text collapses, and a stale finding then disappears instead of pointing at the wrong words. A `MutationObserver` on the editor's root sees changes, and hover is hit-tested with `caretPositionFromPoint`. A fix selects the range and runs `execCommand("insertText")` from the page's world, because Notion ignores edits made from the isolated world. At most 2000 findings are painted at once.

`web/src/editor/domText.ts` reads a block editor's leaves as one string with a map back to the DOM. Leaves are joined by a blank line. Text nodes are read in document order. An atom, which is an element the site marks `contenteditable="false"` or one it excludes, such as inline code, becomes one U+FFFC that the core skips. A `<br>` becomes a line break, and a block element inside a leaf starts and ends a line, which is how Gmail's `<div>`-per-line body reads as lines. A site supplies `DomEditorRules`: which leaves hold prose, which elements are atoms, a selector for the site's dark theme, and whether the site leaves the root's `spellcheck` attribute alone (Gmail does, Notion does not).

Both adapters share the card (`card.ts`, `popover.ts`, `styles.ts`). The card opens when the pointer rests on a finding for 300 ms, and the controller drops a fetch that returns for a target the pointer has left. It closes on any edit and on Escape, and a recheck that drops or reshapes the finding closes it too.

The config page uses a third adapter, `monacoAdapter.ts`, so the client's own `ConfigStatusView` can draw gutter marks and squiggles in Monaco.

## Foreign checkers and site dictionaries

A foreign checker is a checker that is not one of the core's engines but marks the same text. Overleaf and Typst have one each. `web/src/editor/foreign.ts` reads them with one generic reader and a `ForeignCheckerSpec` per checker: a checker name, a rule, the category, the class token of its marks, a function that reads the language, and the selectors that hide its marks. Marks are found through CodeMirror's public `EditorView.decorations` facet. A finding that touches text edited since the checker last recomputed is not reported. The checker's marks lag an edit by one to a few seconds.

The page sends the findings with the text they were read against. The client's `Checker` converts them to byte offsets and sends them with every request of the check. In the core (`rust-core/src/foreign.rs`) each is treated as one more engine's finding. It is kept only inside the prose ranges the check covers and clear of their exclusions, and only where the host read the word in the language the core read the passage in. It takes the severity of its category with the user's `rules:` override. Foreign findings join after the engines' answer is stored, so a stored result never depends on a host's worker, and before the suppression pass, so the dictionary, ignores, names and identifiers apply to them. The document-level `merge_duplicates` then folds them into the engines' findings on the same span, and where an engine disagrees about the span the foreign finding yields. The rule id is `<checker>.<rule>`, such as `typst.misspelling`, and a spelling finding's unified id is `spelling.typo`, so it merges with an engine's spelling finding on the same span. A set of foreign findings that changes without the text changing triggers a new check, which costs an extraction and a round trip because the engines answer from their cache.

The options page's three modes are `merge`, `ours` and `both` (`ForeignMode` in `protocol.ts`). Only `merge` sends findings. Notion and Gmail have no readable foreign checker, since the browser's own spellchecker cannot be read, so for them the modes decide only whether the browser's checker is switched off where the site allows it.

A site that keeps a dictionary implements `SiteDictionarySource` (`web/src/sites/site.ts`): `read()`, `watch()` and `add()`. The page reads it with the site's own session and sends it as a `SiteDictionaryRequest`. The core (`rust-core/src/site_dictionary.rs`) coerces the entries into words: trimmed, dropped and counted when not one word, folded case-insensitively, capped. It writes `.languagecheck/site-dictionary.txt` with a header naming the site, the time and the drop count, and swaps the words into the dictionary at once. `dictionaries.site` and `dictionaries.add_to` choose what happens next, and the config probe reports both. A write to the site goes core, then `SiteWriteResponse`, then the page, which writes as the site's own editor does. The core's next copy of the site's dictionary settles it, so a failed write undoes itself.

## Site documents as workspace files

A site's documents have no files on disk, so the config's `include`, `exclude` and `file_types` would never apply to them. Each site names its document by a path instead, and each check carries it as `document_path`. The core accepts only a relative, `/`-separated path of plain segments, with no drive-like segment on any platform and at most 1024 bytes (`selection::document_path`). A site that has files supplies `SiteFiles.list()` (Overleaf reads `/project/<id>/entities`, Typst reads its GraphQL file list), and the Inspector's Config tab sorts that list under the config. A site with no files, like Gmail, has none, and the tab says so.

## Webview panels and split view

SpeedFix and the Inspector are the client's own webview apps. Their panel code runs in the page through the shim, and the app itself runs in an extension tab. The apps are the client's own (`extension/webview/`, built by `pnpm run build:webview`), and `web/esbuild.mjs` copies them into the extension with a theme file for the variables VS Code would set (`web/webview/theme.css`). Messages travel page, content script, background and panel tab, and each hop parses the message again. Panels are named by the background as `<tab id>:<page's id>`, so one tab cannot address another's. `web/src/webview/bridge.ts` runs in the panel tab and stands in for the VS Code webview host: it provides `acquireVsCodeApi()` and holds messages that arrive before the app has said it is ready.

The first panel opens as the page's split-view partner in Chrome 155 and later, through the `splitWithTabId` option of `tabs.create` and `tabs.createSplit` (`web/src/background/splitTabs.ts`). Whether `tabs.createSplit` exists is how it tells that the browser knows splits. Firefox can read splits but cannot make them, and its path is switched off by `GECKO_SPLIT_VERIFIED` until a Firefox that makes splits has been tried. Where a split is refused, the panel is a plain tab.

## The config page

Edit Config opens `web/config.html` in an extension tab for one workspace (`web/src/config/page.ts`). It is Monaco, with the client's `ConfigStatusView` drawing gutter marks and squiggles. It reads, probes and writes the config only through the config port (`web/src/messaging/config.ts`), which a web page cannot reach. A save goes through the native host, then the background re-initializes the core and tells every page on the workspace to check again. The page saves about a second after the last keystroke.
