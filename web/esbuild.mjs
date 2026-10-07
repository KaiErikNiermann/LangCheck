// Builds the extension into dist/. `--test` also matches the local pages the
// end-to-end tests serve (http://127.0.0.1 stands in for Overleaf,
// http://localhost for Typst), in a separate dist-test/.
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const test = process.argv.includes('--test');
const outdir = test ? 'dist-test' : 'dist';
const SITES = ['overleaf', 'typst'];

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
    target: ['firefox128', 'chrome120'],
    // The feature is written against `vscode`; in the browser that is the shim.
    alias: { vscode: './src/shim/vscode.ts' },
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
    const local = { overleaf: 'http://127.0.0.1/project/*', typst: 'http://localhost/project/*' };
    for (const script of manifest.content_scripts) {
        const site = SITES.find((s) => script.js[0].endsWith(`-${s}.js`));
        script.matches.push(local[site]);
    }
}
await mkdir(outdir, { recursive: true });
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile('icon-128.png', `${outdir}/icon.png`);
