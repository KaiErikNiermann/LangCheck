import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';

/**
 * End-to-end benchmarks: the real editor and core over generated documents
 * and workspaces, each timing sampled several times.
 *
 * Not part of `test:e2e` and not run in CI. They are a sanity check that no
 * case -- a huge document, a malformed one, a workspace of thousands of
 * files -- takes an unreasonable time on this machine, and a record of what
 * each took. See src/test/e2e/bench/measure.ts for the gate, which is only
 * a ceiling far above a normal run.
 *
 *     pnpm run bench:e2e                            # every suite
 *     pnpm run bench:e2e --label bench-documents    # one of them
 *     BENCH_GATE=off BENCH_REPS=3 pnpm run bench:e2e
 *
 * Wrapping it in memguard (`memguard run -t 85 -- pnpm run bench:e2e`) is
 * worth it: the large cases hold a lot of text in two processes at once.
 *
 * Results are appended to .vscode-test/bench/results.jsonl, one line per
 * metric, so runs can be compared.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { BENCH_CONFIG, generateWorkspace } = require('./out/test/e2e/bench/corpus.js');

const benchDir = path.join(here, '.vscode-test', 'bench');

/** Bumped when the generators change, so a stale workspace is rebuilt. */
const CORPUS_VERSION = 1;

/**
 * A benchmark workspace, generated once and reused while its shape holds,
 * with a fresh index database every run.
 *
 * The database is what makes a second run fast: the core stores every
 * result in it, keyed by the text. Left in place, a "cold" check on the
 * second run would be answered from the first.
 */
function workspace(name, shape) {
    const root = path.join(benchDir, 'workspaces', name);
    const stamp = path.join(root, '.bench-stamp');
    const want = JSON.stringify({ CORPUS_VERSION, shape });
    // The documents suite writes its own files each run, so its workspace
    // starts empty every time.
    if (shape === null || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
        fs.rmSync(root, { recursive: true, force: true });
        if (shape === null) {
            fs.mkdirSync(root, { recursive: true });
            fs.writeFileSync(path.join(root, '.languagecheck.yaml'), BENCH_CONFIG);
        } else {
            generateWorkspace(root, shape, 1);
        }
        fs.writeFileSync(stamp, want);
    }
    const db = path.join(benchDir, 'db', `${name}.redb`);
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.rmSync(db, { force: true });
    fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
    fs.writeFileSync(
        path.join(root, '.vscode', 'settings.json'),
        JSON.stringify({ 'languageCheck.workspace.dbPath': db }, null, 4),
    );
    return root;
}

function commit() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

const env = {
    BENCH_OUT: benchDir,
    BENCH_COMMIT: commit(),
    BENCH_CLI: path.join(here, '..', 'rust-core', 'target', 'release', 'language-check'),
    // Mixed into every generated document's seed, so no run can be answered
    // from what an earlier one stored.
    BENCH_SALT: String(Date.now() % 1_000_000),
    ...(process.env.BENCH_REPS ? { BENCH_REPS: process.env.BENCH_REPS } : {}),
    ...(process.env.BENCH_GATE ? { BENCH_GATE: process.env.BENCH_GATE } : {}),
};

// Long enough for the largest case's repetitions; the gate, not the
// timeout, is what judges a slow case.
const mocha = { ui: 'tdd', timeout: 30 * 60_000 };
const launchArgs = ['--disable-extensions'];

export default defineConfig([
    {
        label: 'bench-documents',
        files: 'out/test/e2e/bench/documents.bench.js',
        workspaceFolder: workspace('documents', null),
        launchArgs, env, mocha,
    },
    {
        // 5,000 files in 100 directories, which the core indexes on open.
        label: 'bench-workspace-large',
        files: 'out/test/e2e/bench/workspace.bench.js',
        workspaceFolder: workspace('large', { dirs: 100, filesPerDir: 50, fileBytes: 1_500, depth: 1 }),
        launchArgs, env, mocha,
    },
    {
        // 20 trees 20 levels deep, each level its own project with its own
        // config: 2,000 files and 380 nested configs, all of which the one
        // config at the root governs.
        label: 'bench-workspace-nested',
        files: 'out/test/e2e/bench/workspace.bench.js',
        workspaceFolder: workspace('nested', { dirs: 20, filesPerDir: 5, fileBytes: 1_500, depth: 20 }),
        launchArgs, env, mocha,
    },
]);
