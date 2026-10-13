// Builds the extension into dist/. `--test` also matches the local pages the
// end-to-end tests serve (http://127.0.0.1 stands in for Overleaf,
// http://localhost for Typst, http://127.0.0.2 for Notion, http://127.0.0.3
// for Gmail), in a separate
// dist-test/.
import * as esbuild from 'esbuild';
import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const test = process.argv.includes('--test');
const manifestVersion = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const outdir = test ? 'dist-test' : 'dist';
const SITES = ['overleaf', 'typst', 'notion', 'gmail'];

const result = await esbuild.build({
    entryPoints: Object.fromEntries([
        ['background', 'src/entries/background.ts'],
        ['palette', 'src/palette/page.ts'],
        ['options', 'src/options/options.ts'],
        ['webview/bridge', 'src/webview/bridge.ts'],
        // The config page, and Monaco's editor worker for it.
        ['config/config', 'src/config/page.ts'],
        ['config/editor.worker', 'monaco-editor/editor/editor.worker.js'],
        ...SITES.flatMap((s) => [
            [`content-${s}`, `src/entries/content-${s}.ts`],
            [`page-${s}`, `src/entries/page-${s}.ts`],
        ]),
    ]),
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['firefox128', 'chrome128'],
    // The feature is written against `vscode`; in the browser that is the shim.
    // `path` in the client's modules (display names, asset paths) is path-browserify.
    alias: { vscode: './src/shim/vscode.ts', path: 'path-browserify' },
    define: { __LANGUAGE_CHECK_TEST__: String(test), __LANGUAGE_CHECK_VERSION__: JSON.stringify(manifestVersion) },
    sourcemap: test ? 'inline' : false,
    minify: !test,
    metafile: true,
    // Monaco's styles and its icon font, for the config page.
    loader: { '.ttf': 'file' },
    logLevel: 'warning',
});

// The page bundles join the site's own editor through its own CodeMirror
// instances. A bundled copy cannot share identity with them, so one
// slipping in is a bug, not just weight.
for (const [file, output] of Object.entries(result.metafile.outputs)) {
    if (!file.includes('page-')) continue;
    const leaked = Object.keys(output.inputs).filter((input) => input.includes('@codemirror'));
    if (leaked.length > 0) throw new Error(`${file} bundles CodeMirror:\n${leaked.join('\n')}`);
}

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (test) {
    const local = { overleaf: 'http://127.0.0.1/project/*', typst: 'http://localhost/project/*', notion: 'http://127.0.0.2/*', gmail: 'http://127.0.0.3/mail/*' };
    for (const script of manifest.content_scripts) {
        const site = SITES.find((s) => script.js[0].endsWith(`-${s}.js`));
        script.matches.push(local[site]);
    }
    // Resources are matched by origin only (the path must be /*).
    const origins = Object.values(local).map((pattern) => `${new URL(pattern.replace('*', '')).origin}/*`);
    for (const resources of manifest.web_accessible_resources) resources.matches.push(...origins);
}
// The tab's current URL names its workspace (single-page apps move without a
// load, and a port's sender.url stays the URL the page loaded with); reading
// it needs host permission, for exactly the pages the scripts already run in.
manifest.host_permissions = [...new Set(manifest.content_scripts.flatMap((script) => script.matches))];

// Browsers refuse to load a manifest whose web_accessible_resources match a
// path other than /* (Chrome then never starts the extension at all).
for (const resources of manifest.web_accessible_resources) {
    const bad = resources.matches.filter((pattern) => !pattern.endsWith('/*') || new URL(pattern.replace('*', '')).pathname !== '/');
    if (bad.length > 0) throw new Error(`web_accessible_resources must match whole origins (path /*): ${bad.join(', ')}`);
}
await mkdir(outdir, { recursive: true });
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile('icon-128.png', `${outdir}/icon.png`);
for (const page of ['palette.html', 'options.html', 'config.html']) await copyFile(page, `${outdir}/${page}`);
// The gutter icons ConfigStatusView draws, from the extension's media.
await cp('../extension/media/gutter', `${outdir}/config/media/gutter`, { recursive: true });

// The panels: the client's own webview apps (extension/webview, built by
// `pnpm run build:webview`), each in a page shaped like the one VS Code gives
// it (extension/src/ui/webviews/html.ts), plus the theme variables VS Code
// would set and the bridge that stands in for the webview host.
const WEBVIEW_DIST = '../extension/webview/dist/assets';
const PANELS = [
    { viewType: 'speedFix', script: 'index', title: 'SpeedFix' },
    { viewType: 'inspector', script: 'inspector', title: 'Inspector' },
];
await access(WEBVIEW_DIST).catch(() => {
    throw new Error(`${WEBVIEW_DIST} is missing: run pnpm run build:webview first`);
});
await cp(WEBVIEW_DIST, `${outdir}/webview/assets`, { recursive: true });
await copyFile('webview/theme.css', `${outdir}/webview/theme.css`);
for (const { viewType, script, title } of PANELS) {
    await writeFile(
        `${outdir}/webview/${viewType}.html`,
        `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="theme.css">
    <link rel="stylesheet" href="assets/${script}.css">
    <title>${title} - LangCheck</title>
    <script src="bridge.js"></script>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="assets/${script}.js"></script>
</body>
</html>
`,
    );
}

// The fake site pages, each with its own CodeMirror (current and 6.38).
if (test) {
    /** @type {{ name: string, alias: Record<string, string> }[]} */
    const variants = [
        { name: 'current', alias: {} },
        { name: '6-38', alias: { '@codemirror/view': 'cm-view-6-38', '@codemirror/lint': 'cm-lint-6-9-5' } },
    ];
    await esbuild.build({
        entryPoints: ['test/e2e/fakeNotion.ts'],
        outfile: '.e2e/pages/fake-notion.js',
        bundle: true,
        format: 'iife',
        platform: 'browser',
        logLevel: 'warning',
    });
    await esbuild.build({
        entryPoints: ['test/e2e/stubContent.ts'],
        outfile: '.e2e/pages/stub-content.js',
        bundle: true,
        format: 'iife',
        platform: 'browser',
        logLevel: 'warning',
    });
    await Promise.all(
        variants.map(({ name, alias }) =>
            esbuild.build({
                entryPoints: ['test/e2e/fakeHost.ts'],
                outfile: `.e2e/pages/fake-host-${name}.js`,
                bundle: true,
                format: 'iife',
                platform: 'browser',
                alias,
                logLevel: 'warning',
            }),
        ),
    );
}
