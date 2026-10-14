# LangCheck for web editors

A browser extension (Firefox 128+, Chrome 128+) that checks prose in Overleaf, Typst, Notion and Gmail with the LangCheck core running on your machine. It is the VS Code client's checking path behind a `vscode` shim: the code that turns the core's findings into squiggles, fixes and hints is the same code VS Code runs.

## How it fits together

```
page world (site's realm)        content script         background            native host            core
shim + feature + CM6 adapter  ─▶ validates, relays  ─▶  one host per      ─▶  language-check-   ─▶  language-check-
joins the site's own editor      MessagePort            project, backoff      native-host            server
```

- The page world joins the site's own CodeMirror 6 editor. It finds the CodeMirror classes by shape in the running editor (`src/editor/cm6kit.ts`) because a bundled copy could not share identity with the page's; the build fails if one slips into a page bundle.
- A site is a few facts in `src/sites/`: where the editor is, what the open document is called, what language it is in. Everything else is shared. Adding one takes a row in `src/sites/catalog.ts` (its id, name, origins, paths and the test stand-in's origin) and a module `src/sites/<id>.ts` exporting `site` (its workspace and page), listed in `src/sites/workspaces.ts`, which does not compile without it. The build generates the site's content and page scripts and the manifest's matches and description from the catalog (`src/build/sites.ts`), and `test/unit/siteCatalog.test.ts` holds the three to each other.
- Notion has no CodeMirror: it is a block editor of `contenteditable` leaves. `src/editor/domAdapter.ts` paints findings there with the CSS Custom Highlight API (live DOM ranges, no DOM changes, so nothing fights Notion's renderer), reads the text through `src/editor/domText.ts`, and applies a fix as typed input. It needs the Highlight API: Firefox 140+, Chrome 105+. Notion's code blocks, inline code and equations are not checked; there are no inlay hints, since highlights can only style existing text (`research/notion-editor.md` has the evaluation).
- Gmail goes through the same DOM editor, with the compose body as one leaf whose `<div>` lines are read as lines (`research/gmail-editor.md`). The compose being written in is checked; the quoted message and the signature are not. The small and the full-screen compose are one element at two sizes, so findings stay through the switch. While findings are merged or ours alone (the options page), the browser's own spellchecker is switched off on the body and put back after; Gmail, unlike Notion, leaves that attribute alone.
- Both editors share the card (`src/editor/card.ts`, `popover.ts`) and its styles.
- `language-check-native-host` (in `rust-core/`) relays to the unchanged `language-check-server`, so checking, caching, dictionaries and suppression are the same as in VS Code.
- The command palette (Alt+Shift+P by default, changeable on the options page) is ninja-keys in an extension-page iframe over the site. It lists the client's commands that mean something on the web, under their VS Code titles (`src/palette/`).
- SpeedFix and the Inspector are the client's own webview apps, each in an extension tab beside the page (`src/background/panels.ts`, `src/webview/bridge.ts`). Their panel code runs in the page through the shim, and messages travel page, content script, background, panel tab.
- "Edit Config" opens the workspace's config in an extension tab (`src/config/page.ts`): Monaco, with the client's own `ConfigStatusView` drawing gutter marks and squiggles through the shim, as VS Code shows the file. A save goes through the native host; the background then re-initializes the core and every page on the workspace checks again under the new config.

## Trust

The page world runs next to the site's own scripts and any other extension's, so everything it sends is untrusted. The content script parses each request strictly (characters and bytes) and gives each page port its own panel ids. The background takes the workspace from the tab's current URL as the browser reports it, never from a message; opens at most one panel of each kind and ten tabs a minute for a page; and moves focus between a page's tabs only while the user is in one of them. Reading, writing and probing a config is open only to the extension's own config page, on its own port. The native host strips file paths, confines workspaces to its data directory, refuses a config that would run a program or name a file outside its workspace, and scrubs paths from what it answers. Errors reach the page as a fixed sentence per code; the detail is in the extension's console. Every edit names the text it replaces and is refused when the editor no longer holds it, so a fix never lands on text that moved.

## Install (development)

```sh
cd rust-core && cargo build --release
./target/release/language-check-native-host install --browser firefox
# Chrome: --browser chrome --chrome-extension-id <id from chrome://extensions>
cd ../web && pnpm install && pnpm run build
```

Then load `web/dist/manifest.json` as a temporary add-on (Firefox: `about:debugging` → This Firefox → Load Temporary Add-on) or `web/dist` as an unpacked extension (Chrome). Learned words live under `~/.local/share/language-check/web/<site>-<project>/`: per Overleaf or Typst project, per Notion workspace, and per Gmail account.

## Tests

```sh
pnpm run typecheck && pnpm run lint
pnpm test          # unit tests
pnpm run test:e2e  # builds the core and the test extension, then Playwright
```

`test/e2e/realPath*.spec.ts` drive the whole path in Chromium with the real native host: stand-ins for Overleaf (127.0.0.1) and Typst (localhost), each on CodeMirror 6.43 and 6.38, either side of the 6.39 rewrite that moved its internals, for Notion (127.0.0.2), whose stand-in saves only edits that arrive as input, as Notion does, and has side and centre peeks, and for Gmail (127.0.0.3), served with Gmail's Trusted Types policy so an HTML-string sink in the page code fails a test. `test/e2e/pageLayer.spec.ts` runs the page bundle in Chromium and Firefox against a stub core whose answers can be held. `.jscpd.json` scans this package together with the VS Code client's sources.

What must behave the same in VS Code and in the browser is written once, next to the VS Code UI tests, and run by both: each host's spec supplies a driver for its own window.

| Scenarios | VS Code | Browser |
| --- | --- | --- |
| `extension/src/test/ui/speedFixScenarios.ts` | `speedFix.spec.ts` | `realPathSpeedFix.spec.ts` |
| `extension/src/test/ui/inspectorScenarios.ts` | `inspector.spec.ts` | `realPathInspector.spec.ts` |
| `extension/src/test/ui/configScenarios.ts` | `config.spec.ts` | `realPathConfig.spec.ts` |

Each spec keeps beside them only what is its host's own (VS Code's window sizes and files; the browser's tabs, collaborators' edits, the host's refusals).

`realPathScale.spec.ts` and `realPathMemory.spec.ts` are permanent fixtures for long documents and memory: a 4000-line document checked whole, the size cap, and heap snapshots that must show no kind of object growing per re-check, panel cycle or file switch. Their figures go to `.bench/scale.jsonl`. The benchmarks, memory bounds and soak (`pnpm run bench`, `test/bench/`, the release core) are described with their results in `docs/reference/benchmarks.md`. The server's own memory over 100 000 checks is `rust-core/tests/server_protocol.rs` `checking_for_long_does_not_grow_the_server`, run on demand with `--ignored` (seven minutes).
