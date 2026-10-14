// Builds .bench/live-compare.js (compare.js with the benchmarks' corpus
// bundled in front of it) and .bench/live-load.js (load.js), each one
// function body for the browser-viewer MCP's `evaluate` in Firefox's
// content-script world. See each for its use.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const here = import.meta.dirname;
const web = path.resolve(here, '../../..');
const corpus = await build({
    entryPoints: [path.resolve(web, '../extension/src/test/e2e/bench/corpus.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'LcCorpus',
    minify: true,
    write: false,
    // The corpus writes workspaces with node:fs; the generators used here need
    // neither. esbuild's filters are Go regexps, which take no `u` flag.
    plugins: [{
        name: 'no-node',
        setup: (b) => {
            b.onResolve({ filter: /^node:/ }, () => ({ path: 'node', namespace: 'stub' }));
            b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}' }));
        },
    }],
});
const out = path.join(web, '.bench', 'live-compare.js');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${corpus.outputFiles[0]?.text ?? ''}\n${readFileSync(path.join(here, 'compare.js'), 'utf8')}`);
// load.js needs no corpus: served as it is.
copyFileSync(path.join(here, 'load.js'), path.join(web, '.bench', 'live-load.js'));
console.info(`wrote ${out} and live-load.js`);
