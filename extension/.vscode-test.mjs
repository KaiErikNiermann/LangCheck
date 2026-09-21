import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end tests: a real VS Code, this extension loaded, a real workspace.
 *
 * The unit tests under `src/test/*.test.ts` run in vitest and cover pure
 * logic. These cover what only a running editor can show -- whether a check
 * actually fired after a document opened, whether anything was drawn, and
 * whether a refusal survives a reload.
 *
 * Nothing else may be able to answer for a diagnostic, a hint or a code
 * action, or a green run would prove nothing about this extension.
 */
const launchArgs = ['--disable-extensions'];

/**
 * Shared by the two phases of the suppression test, and by nothing else.
 *
 * A refusal is stored in globalState, which lives in the user data directory.
 * Pointing both phases at one directory and giving every other config its own
 * is what makes phase two a reload rather than a continuation -- and what
 * stops a refusal leaking into the tests that are not about one.
 */
// Absolute: `--user-data-dir` resolves against VS Code's working directory,
// which is not guaranteed to be the same for both launches, and two phases
// pointed at different directories would make phase two pass by finding
// nothing rather than by the refusal being honoured.
const declineUserDataDir = path.join(here, '.vscode-test', 'user-data-decline');

export default defineConfig([
    {
        label: 'startup',
        files: 'out/test/e2e/startup.test.js',
        workspaceFolder: './src/test/fixtures/basic',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 90_000 },
    },
    {
        label: 'invariants',
        files: 'out/test/e2e/invariants.test.js',
        workspaceFolder: './src/test/fixtures/basic',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        label: 'reload',
        files: 'out/test/e2e/reload.test.js',
        workspaceFolder: './src/test/fixtures/basic',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 90_000 },
    },
    {
        label: 'dictionaries',
        files: 'out/test/e2e/dictionaries.test.js',
        workspaceFolder: './src/test/fixtures/dictionaries',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        label: 'pragmas',
        files: 'out/test/e2e/pragmas.test.js',
        workspaceFolder: './src/test/fixtures/pragmas',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        // A second window over the same workspace: the stored result from the
        // run above is what may answer here.
        label: 'pragmas-reload',
        files: 'out/test/e2e/pragmasReload.test.js',
        workspaceFolder: './src/test/fixtures/pragmas',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        label: 'config-edits',
        files: 'out/test/e2e/configEdits.test.js',
        workspaceFolder: './src/test/fixtures/configEdits',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'dictionary-paths',
        files: 'out/test/e2e/dictionaryPaths.test.js',
        workspaceFolder: './src/test/fixtures/dictPaths',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'engines-live',
        files: 'out/test/e2e/enginesLive.test.js',
        workspaceFolder: './src/test/fixtures/enginesLive',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'config-probe',
        files: 'out/test/e2e/configProbe.test.js',
        workspaceFolder: './src/test/fixtures/configProbe',
        launchArgs,
        // Several cases start a server, break it, and wait for the marks to
        // follow, which is a few round trips each.
        mocha: { ui: 'tdd', timeout: 200_000 },
    },
    {
        label: 'external-engines',
        files: 'out/test/e2e/externalEngines.test.js',
        workspaceFolder: './src/test/fixtures/externalEngines',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'exclude',
        files: 'out/test/e2e/exclude.test.js',
        workspaceFolder: './src/test/fixtures/exclude',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'schemas',
        files: 'out/test/e2e/schemas.test.js',
        workspaceFolder: './src/test/fixtures/schemas',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 150_000 },
    },
    {
        label: 'pack-install',
        files: 'out/test/e2e/packInstall.test.js',
        workspaceFolder: './src/test/fixtures/packInstall',
        launchArgs,
        // A real pack is fetched over the network, which is slower than
        // anything else here.
        mocha: { ui: 'tdd', timeout: 300_000 },
    },
    {
        label: 'cache-phase1',
        files: 'out/test/e2e/cacheReusePhase1.test.js',
        workspaceFolder: './src/test/fixtures/cache',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        // A second window over the same workspace. The core keys its index by
        // the workspace root, so this one finds what the first one stored.
        label: 'cache-phase2',
        files: 'out/test/e2e/cacheReusePhase2.test.js',
        workspaceFolder: './src/test/fixtures/cache',
        launchArgs,
        mocha: { ui: 'tdd', timeout: 120_000 },
    },
    {
        label: 'decline-phase1',
        files: 'out/test/e2e/declinePhase1.test.js',
        workspaceFolder: './src/test/fixtures/packs',
        launchArgs: [...launchArgs, '--user-data-dir', declineUserDataDir],
        mocha: { ui: 'tdd', timeout: 90_000 },
    },
    {
        // A second window over the same user data, which is the reload.
        label: 'decline-phase2',
        files: 'out/test/e2e/declinePhase2.test.js',
        workspaceFolder: './src/test/fixtures/packs',
        launchArgs: [...launchArgs, '--user-data-dir', declineUserDataDir],
        mocha: { ui: 'tdd', timeout: 90_000 },
    },
]);
