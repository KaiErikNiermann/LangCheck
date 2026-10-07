// Builds the extension into dist/. `--test` also matches the local pages the
// end-to-end tests serve (http://127.0.0.1 stands in for Overleaf,
// http://localhost for Typst, http://127.0.0.2 for Notion), in a separate
// dist-test/.
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const test = process.argv.includes('--test');
const manifestVersion = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const outdir = test ? 'dist-test' : 'dist';
const SITES = ['overleaf', 'typst', 'notion'];

const result = await esbuild.build({
    entryPoints: Object.fromEntries([
        ['background', 'src/entries/background.ts'],
        ['palette', 'src/palette/page.ts'],
        ['options', 'src/options/options.ts'],
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
    const local = { overleaf: 'http://127.0.0.1/project/*', typst: 'http://localhost/project/*', notion: 'http://127.0.0.2/*' };
    for (const script of manifest.content_scripts) {
        const site = SITES.find((s) => script.js[0].endsWith(`-${s}.js`));
        script.matches.push(local[site]);
    }
    // Resources are matched by origin only (the path must be /*).
    const origins = Object.values(local).map((pattern) => `${new URL(pattern.replace('*', '')).origin}/*`);
    for (const resources of manifest.web_accessible_resources) resources.matches.push(...origins);
}
// Browsers refuse to load a manifest whose web_accessible_resources match a
// path other than /* (Chrome then never starts the extension at all).
for (const resources of manifest.web_accessible_resources) {
    const bad = resources.matches.filter((pattern) => !pattern.endsWith('/*') || new URL(pattern.replace('*', '')).pathname !== '/');
    if (bad.length > 0) throw new Error(`web_accessible_resources must match whole origins (path /*): ${bad.join(', ')}`);
}
await mkdir(outdir, { recursive: true });
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile('icon-128.png', `${outdir}/icon.png`);
for (const page of ['palette.html', 'options.html']) await copyFile(page, `${outdir}/${page}`);

// The fake site pages, each with its own CodeMirror (current and 6.38).
if (test) {
    /** @type {{ name: string, alias: Record<string, string> }[]} */
    const variants = [
        { name: 'current', alias: {} },
        { name: '6-38', alias: { '@codemirror/view': 'cm-view-6-38' } },
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
