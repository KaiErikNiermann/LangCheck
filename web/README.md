# LangCheck for web editors

A browser extension (Firefox 128+, Chrome 128+) that checks prose in Overleaf, Typst and Notion with the LangCheck core running on your machine. It is the VS Code client's checking path behind a `vscode` shim: the code that turns the core's findings into squiggles, fixes and hints is the same code VS Code runs.

## How it fits together

```
page world (site's realm)        content script         background            native host            core
shim + feature + CM6 adapter  ─▶ validates, relays  ─▶  one host per      ─▶  language-check-   ─▶  language-check-
joins the site's own editor      MessagePort            project, backoff      native-host            server
```

- The page world joins the site's own CodeMirror 6 editor. It finds the CodeMirror classes by shape in the running editor (`src/editor/cm6kit.ts`) because a bundled copy could not share identity with the page's; the build fails if one slips into a page bundle.
- A site is a few facts in `src/sites/`: where the editor is, what the open document is called, what language it is in. Everything else is shared.
- Notion has no CodeMirror: it is a block editor of `contenteditable` leaves. `src/editor/domAdapter.ts` paints findings there with the CSS Custom Highlight API (live DOM ranges, no DOM changes, so nothing fights Notion's renderer), reads the text through `src/editor/domText.ts`, and applies a fix as typed input. It needs the Highlight API: Firefox 140+, Chrome 105+. Notion's code blocks, inline code and equations are not checked; there are no inlay hints, since highlights can only style existing text (`research/notion-editor.md` has the evaluation).
- Both editors share the card (`src/editor/card.ts`, `popover.ts`) and its styles.
- `language-check-native-host` (in `rust-core/`) relays to the unchanged `language-check-server`, so checking, caching, dictionaries and suppression are the same as in VS Code.

## Trust

The page world runs next to the site's own scripts, so everything it sends is untrusted. The content script parses each request strictly; the background takes the workspace from the tab's URL as the browser reports it, never from a message; the native host strips file paths, confines workspaces to its data directory and refuses config probing. Errors reach the page as a fixed sentence per code; the detail is in the extension's console.

## Install (development)

```sh
cd rust-core && cargo build --release
./target/release/language-check-native-host install --browser firefox
# Chrome: --browser chrome --chrome-extension-id <id from chrome://extensions>
cd ../web && pnpm install && pnpm run build
```

Then load `web/dist/manifest.json` as a temporary add-on (Firefox: `about:debugging` → This Firefox → Load Temporary Add-on) or `web/dist` as an unpacked extension (Chrome). Learned words live under `~/.local/share/language-check/web/<site>-<project>/`: per Overleaf or Typst project, and per Notion workspace.

## Tests

```sh
pnpm run typecheck && pnpm run lint
pnpm test          # unit tests
pnpm run test:e2e  # builds the core and the test extension, then Playwright
```

`test/e2e/realPath*.spec.ts` drive the whole path in Chromium with the real native host: stand-ins for Overleaf (127.0.0.1) and Typst (localhost), each on CodeMirror 6.43 and 6.38, either side of the 6.39 rewrite that moved its internals, and for Notion (127.0.0.2), whose stand-in saves only edits that arrive as input, as Notion does. `test/e2e/pageLayer.spec.ts` runs the page bundle in Chromium and Firefox against a stub core whose answers can be held. `.jscpd.json` scans this package together with the VS Code client's sources.
