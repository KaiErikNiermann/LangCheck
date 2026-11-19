# Developing the browser extension

:::{admonition} Beta
:class: note
The browser extension is in early development, and its build and test setup changes often. Please [report bugs](https://github.com/KaiErikNiermann/LangCheck/issues) and they will be fixed promptly.
:::

This page covers building the extension, adding a site and running its tests. [Architecture](architecture.md) explains how the parts fit together. The package is `web/` in the repository, and `web/README.md` is a shorter, denser version of both pages.

## Building

The extension is built with esbuild from `web/`, with TypeScript sources in `web/src/`.

```sh
just build-web         # from the repository root
cd web && pnpm install && pnpm run build   # the same, by hand
```

`pnpm run build` builds the client's webview apps (`pnpm --dir ../extension run build:webview`) and then runs `node esbuild.mjs`. The output is `web/dist/`, which holds the manifest, one content script and one page script per site, the background, the palette, the options page, the config page and the panel pages. The build targets Firefox 128 and Chrome 128.

The package's `prepare` step generates the client's protobuf bindings, so the client's dependencies have to be installed first. `just build-web` depends on `install-ts` for that reason.

The `ninja-keys` dependency in `web/package.json` is `file:../../../web-tooling/ninja-keys`, a local checkout of [ninja-keys](https://github.com/KaiErikNiermann/ninja-keys) three directory levels above `web/`. A clean clone needs that checkout at that path before `pnpm install` succeeds.

`web/manifest.json` holds what is fixed. The build adds the `content_scripts`, the `web_accessible_resources` matches and the description from the [site catalog](#adding-a-site), so the manifest never lists a site by hand. The manifest has both `background.service_worker` and `background.scripts`, for Chrome and Firefox. Its permissions are `nativeMessaging` and `storage`.

Three build modes share one script.

- `node esbuild.mjs` builds `web/dist/`.
- `node esbuild.mjs --test` builds `web/dist-test/`, which also matches each site's stand-in origin, a loopback address of its own. The end-to-end tests load it.
- `node esbuild.mjs --dev` builds `web/dist-dev/` and keeps watching. After each build it announces a build id over a loopback WebSocket on `127.0.0.1:35817`, and the dev extension reloads itself from disk with `runtime.reload()` when the id differs from its own. The release build refuses to contain any of the reload code.

For the dev build, run `just dev-web` from the repository root. It builds the release core and registers the host with Firefox. When `CHROME_EXTENSION_ID` is set it registers Chrome too. Then it runs `pnpm run dev`. Load `web/dist-dev/manifest.json` once. After a reload Firefox injects the new scripts into open tabs itself, and in Chrome the new background reloads the site tabs once.

`just install-local-web` builds the release core and `web/dist` and registers the host, as described in [installing](installation.md). `just install-local` does that and installs the VS Code extension as well.

## Adding a site

A site is a few facts about where its editor is, what the open document is called and what language it is in. Everything else is shared. Three places hold a site, and a compile error or a unit test fails when they disagree.

1. Add a row to `SITES` in `web/src/sites/catalog.ts`: the `id` and a `name` for the manifest's description. Then the real `origins`, and the `paths` on them as match-pattern paths such as `/project/*`. Last is `test`, the loopback origin and paths of the end-to-end stand-in. Real origins are `https`, a stand-in origin is `http://localhost` or `http://127.0.0.<n>`, and every id and origin is unique. The catalog file has no imports, because the build script loads it on its own.
2. Write `web/src/sites/<id>.ts`, exporting `site` of type `SiteModule`. Its `workspace` is a `SiteWorkspace`: the site's `id` and `projectFromPath(pathname)`, which returns the project the URL names or `undefined`. The workspace key is `<id>-<project>`, and the native host accepts only 1 to 128 characters of `A-Z a-z 0-9 . _ -` that do not start with a dot, so a project id has to be a URL-safe token. Its `createPage()` returns a `SitePage`, made in the page and never on import, because the background imports the module too.
3. Register the module in `web/src/sites/workspaces.ts`. `SITE_MODULES` is typed over the catalog's ids, so a catalog row with no module does not compile, and a module cannot name a site the catalog lacks.

A `SitePage` has `findEditor()`, which returns an `EditorHandle` for the editor on the page now. For a CodeMirror 6 editor, build it with `cm6Editor(view, name, languageId, foreignSpecs, path)`. For a block editor of `contenteditable` leaves, build it with `domEditor(root, identity, name, languageId, rules, path)`, where `rules` is the `DomEditorRules` of `web/src/editor/domAdapter.ts`. A `SitePage` may also have `dictionary` (a `SiteDictionarySource`) and `files` (a `SiteFiles`, giving the site's documents as workspace files). A site with neither has no dictionary and no files, as Gmail has neither.

The build derives the rest from the catalog (`web/src/build/sites.ts`). Each site's content script and page script come from a generated entry. The manifest's matches and description, the test build's stand-in origins and the background's table of origins (`web/src/sites/registry.ts`) come from it too. `web/test/unit/siteCatalog.test.ts` holds the catalog, the site modules and the derived manifest to each other.

Then add what a site needs to be tested. The stand-ins are in `web/test/e2e/`: `fakeHost.ts` plays Overleaf and Typst on two origins, `fakeNotion.ts` and `fakeGmail.ts` play the other two, and `server.mjs` serves them. Give a new site a stand-in on its catalog row's origin and a `realPath<Site>.spec.ts`. Draw the stand-in from the live site's markup, as the existing ones do. Gmail's stand-in is served with Gmail's Trusted Types policy, so an HTML-string sink in page code fails a test.

## Testing

All commands run from `web/`.

```sh
pnpm run typecheck && pnpm run lint
pnpm test            # unit tests: vitest, test/unit
pnpm run test:e2e    # builds the test extension, then Playwright
pnpm run check       # all of the above
```

`just check` covers the Rust core, the VS Code client and Lua, and does not run these.

The unit tests (`web/test/unit/`) run under vitest with the same `vscode` alias the build uses and no real browser.

The end-to-end tests (`web/test/e2e/`) have two kinds. The global setup builds the debug `language-check-server` and `language-check-native-host` with cargo, then the test extension with `node esbuild.mjs --test`.

- `realPath*.spec.ts` drive the whole path in Chromium with the real native host and the real core. Each test gets its own browser profile, its own data directory and its own host and server. The host is registered in the profile, and the stand-in sites are served by `server.mjs` on loopback addresses. Playwright runs Chromium through its `chromium` channel, because the headless shell cannot load extensions. Playwright cannot load an extension into Firefox, so this kind runs on Chromium only. The Overleaf and Typst stand-ins run CodeMirror 6.43 and 6.38, either side of the 6.39 rewrite. Tests run with no retries.
- `pageLayer.spec.ts` runs the built page bundle in Chromium and Firefox against a stub content script (`stubContent.ts`) whose answers can be held, so the window between an edit and its recheck can be seen. It needs no native host.

`realPathSplit.spec.ts` needs a Chromium newer than the one Playwright pins, because split views arrived in Chrome 155. Point `LC_CHROMIUM` at one:

```sh
LC_CHROMIUM=/path/to/chrome pnpm exec playwright test realPathSplit
```

What must behave the same in VS Code and in the browser is written once, in the client's UI test directory, and both hosts run it. Each host's spec supplies a driver for its own window and keeps only what is its host's own.

| Scenarios | VS Code | Browser |
| --- | --- | --- |
| `extension/src/test/ui/speedFixScenarios.ts` | `speedFix.spec.ts` | `realPathSpeedFix.spec.ts` |
| `extension/src/test/ui/inspectorScenarios.ts` | `inspector.spec.ts` | `realPathInspector.spec.ts` |
| `extension/src/test/ui/configScenarios.ts` | `config.spec.ts` | `realPathConfig.spec.ts` |

Rust tests cover the host and the core's web features: `rust-core/src/native_host.rs` has unit tests for admission and the config confinement, and `rust-core/tests/server_protocol.rs` runs against the server binary.

### Scale, memory and benchmarks

`realPathScale.spec.ts` and `realPathMemory.spec.ts` are permanent fixtures for long documents and memory: a 4000-line document checked whole, the size cap, and heap snapshots. The snapshots must show no kind of object growing per re-check, panel cycle or file switch. The benchmarks and the soak run with `pnpm run bench`, under `playwright.bench.config.ts`, against the release core, one test at a time. They are not run in CI. Their method and results are in the [benchmarks reference](../reference/benchmarks.md). `web/.jscpd.json` scans `web/src` together with the client's sources for duplicated code.

## Contributing

The conventions in [CONTRIBUTING.md](https://github.com/KaiErikNiermann/LangCheck/blob/main/CONTRIBUTING.md) apply. A change that adds a field a page may send also changes `parsePageRequest` (see [messages and validation](architecture.md#messages-and-validation)).
