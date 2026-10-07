// Builds the extension into dist/. `--test` also matches the local pages the
// end-to-end tests serve (http://127.0.0.1 stands in for Overleaf,
// http://localhost for Typst, http://127.0.0.2 for Notion), in a separate
// dist-test/.
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const test = process.argv.includes('--test');
const outdir = test ? 'dist-test' : 'dist';
const SITES = ['overleaf', 'typst', 'notion'];

const result = await esbuild.build({
    entryPoints: Object.fromEntries([
        ['background', 'src/entries/background.ts'],
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
    alias: { vscode: './src/shim/vscode.ts' },
    define: { __LANGUAGE_CHECK_TEST__: String(test) },
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
}
await mkdir(outdir, { recursive: true });
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile('icon-128.png', `${outdir}/icon.png`);

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
