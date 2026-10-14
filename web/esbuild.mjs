// Builds the extension into dist/. `--test` also matches the local pages the
// end-to-end tests serve (each site's stand-in origin in the catalog), in a
// separate dist-test/. `--dev` builds into dist-dev/ and keeps watching: after
// each build it tells the dev extension, over a loopback WebSocket, which
// build is current, and the extension reloads itself from disk
// (src/dev/reloadClient.ts). Nothing of that is in dist/.
//
// The sites come from one list, src/sites/catalog.ts: each site's content
// and page scripts are generated entries (src/build/sites.ts), and the
// manifest's content_scripts, resource matches and description are derived
// from it, so a site is added in one place.
import * as esbuild from 'esbuild';
import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const test = process.argv.includes('--test');
const dev = process.argv.includes('--dev') && !test;
const manifestVersion = JSON.parse(await readFile('manifest.json', 'utf8')).version;
let outdir = 'dist';
if (test) outdir = 'dist-test';
else if (dev) outdir = 'dist-dev';
const SRC = path.resolve('src');

/** The catalog and its derivation, compiled here and imported: TypeScript, so the build and the extension read one source. */
async function loadSiteBuild() {
    const bundled = await esbuild.build({ stdin: { contents: "export * from './src/sites/catalog.ts'; export * from './src/build/sites.ts'; export * from './src/dev/protocol.ts';", resolveDir: '.', loader: 'ts' }, bundle: true, format: 'esm', write: false, logLevel: 'warning' });
    return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const { SITES, contentScripts, entrySource, resourceMatches, siteNames, DEV_BUILD_FILE, DEV_RELOAD_HOST, DEV_RELOAD_PORT, devBuildFile, isExtensionOrigin } = await loadSiteBuild();

/** What the dev build's reloader logs under; the release build must not contain it. */
const DEV_MARKER = '[language-check dev]';

/** `site-entry:<content|page>:<id>`: a site's script, generated from the catalog rather than kept as a file per site. */
const siteEntries = {
    name: 'site-entries',
    setup(build) {
        // esbuild runs these filters as Go regular expressions, which take no `u` flag.
        build.onResolve({ filter: /^site-entry:/ }, (args) => ({ path: args.path, namespace: 'site-entry' }));
        build.onLoad({ filter: /.*/, namespace: 'site-entry' }, (args) => {
            const [, kind, id] = args.path.split(':', 3);
            return { contents: entrySource(kind, id, SRC), loader: 'ts', resolveDir: SRC };
        });
    },
};

/** @type {esbuild.BuildOptions} */
const options = {
    entryPoints: Object.fromEntries([
        // The dev build's background also runs the reloader; the release entry never imports it.
        ['background', dev ? 'src/entries/background.dev.ts' : 'src/entries/background.ts'],
        ['palette', 'src/palette/page.ts'],
        ['options', 'src/options/options.ts'],
        ['webview/bridge', 'src/webview/bridge.ts'],
        // The config page, and Monaco's editor worker for it.
        ['config/config', 'src/config/page.ts'],
        ['config/editor.worker', 'monaco-editor/editor/editor.worker.js'],
        ...SITES.flatMap((site) => [
            [`content-${site.id}`, `site-entry:content:${site.id}`],
            [`page-${site.id}`, `site-entry:page:${site.id}`],
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
    sourcemap: test || dev ? 'inline' : false,
    minify: !test && !dev,
    metafile: true,
    // Monaco's styles and its icon font, for the config page.
    loader: { '.ttf': 'file' },
    logLevel: 'warning',
    plugins: [siteEntries],
};

/**
 * The page bundles join the site's own editor through its own CodeMirror
 * instances. A bundled copy cannot share identity with them, so one
 * slipping in is a bug, not just weight.
 */
function refuseBundledCodeMirror(result) {
    for (const [file, output] of Object.entries(result.metafile.outputs)) {
        if (!file.includes('page-')) continue;
        const leaked = Object.keys(output.inputs).filter((input) => input.includes('@codemirror'));
        if (leaked.length > 0) throw new Error(`${file} bundles CodeMirror:\n${leaked.join('\n')}`);
    }
}

/** The reloader is the dev build's alone. */
async function refuseDevCode(result) {
    for (const file of Object.keys(result.metafile.outputs)) {
        if (!file.endsWith('.js')) continue;
        const text = await readFile(file, 'utf8');
        if (text.includes(DEV_MARKER)) throw new Error(`${file} contains the dev build's reloader`);
    }
}

/** The dev build's manifest: named apart, and with a policy that lets the reloader reach the watcher; the release one may set no policy. */
function finishManifest(manifest) {
    if (!dev) {
        if ('content_security_policy' in manifest) throw new Error('manifest.json sets content_security_policy: only the dev build may');
        return;
    }
    manifest.name = `${manifest.name} (dev)`;
    // Firefox's MV3 default adds upgrade-insecure-requests, which turns the
    // reloader's ws://127.0.0.1 into wss:// (no TLS there, so it never
    // connects); otherwise as both browsers' defaults.
    manifest.content_security_policy = { extension_pages: "script-src 'self'; object-src 'self'" };
}

/** Everything a build writes besides the bundles: the manifest, pages, fonts, panels. */
async function afterBuild(result) {
    refuseBundledCodeMirror(result);
    if (!dev) await refuseDevCode(result);

    const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
    // The sites' parts of the manifest, from the catalog (the test build adds each stand-in's origin).
    manifest.content_scripts = contentScripts(SITES, test);
    for (const resources of manifest.web_accessible_resources) resources.matches = resourceMatches(SITES, test);
    manifest.description = manifest.description.replace('{sites}', () => siteNames(SITES));
    // The tab's current URL names its workspace (single-page apps move without a
    // load, and a port's sender.url stays the URL the page loaded with); reading
    // it needs host permission, for exactly the pages the scripts already run in.
    manifest.host_permissions = [...new Set(manifest.content_scripts.flatMap((script) => script.matches))];

    finishManifest(manifest);

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
    await copyFile('palette.css', `${outdir}/palette.css`);
    // The palette's typefaces (OFL-1.1), shipped with the extension: a page of
    // ours never fetches fonts from the network.
    await mkdir(`${outdir}/fonts`, { recursive: true });
    for (const family of ['ibm-plex-sans', 'ibm-plex-mono']) {
        for (const weight of [400, 500]) {
            const file = `${family}-latin-${String(weight)}-normal.woff2`;
            await copyFile(`node_modules/@fontsource/${family}/files/${file}`, `${outdir}/fonts/${file}`);
        }
    }
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

}

if (dev) {
    const { startDevServer } = await import('./src/build/devServer.mjs');
    const server = await startDevServer({ host: DEV_RELOAD_HOST, port: DEV_RELOAD_PORT, isExtensionOrigin });
    let builds = 0;
    let announcing;
    /** After each build: the rest of the output, then its id (last, so a reload finds the build whole), then the news. */
    const announce = {
        name: 'dev-reload',
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0) {
                    console.error(`[dev] build failed (${String(result.errors.length)} errors): the extension keeps the last good build`);
                    return;
                }
                await afterBuild(result);
                builds += 1;
                const id = `${Date.now().toString(36)}-${String(builds)}`;
                await writeFile(`${outdir}/${DEV_BUILD_FILE}`, devBuildFile(id));
                // One reload for a burst of saves: Chrome stops an unpacked
                // extension that reloads 30 times a second apart.
                clearTimeout(announcing);
                announcing = setTimeout(() => {
                    server.announce(JSON.stringify({ type: 'build', id }));
                    console.info(`[dev] build ${id} written to ${outdir}/; the extension reloads itself`);
                }, 300);
            });
        },
    };
    const context = await esbuild.context({ ...options, plugins: [...options.plugins, announce] });
    await context.watch();
    console.info(`[dev] watching src/; load ${outdir}/ once (Firefox: about:debugging, Load Temporary Add-on). Panels (extension/webview) are not watched: rerun pnpm run build:webview for those.`);
} else {
    await afterBuild(await esbuild.build(options));
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
        entryPoints: ['test/e2e/fakeGmail.ts'],
        outfile: '.e2e/pages/fake-gmail.js',
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
