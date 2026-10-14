// The browser extension's benchmarks and memory soaks (test/bench), apart
// from the e2e tests: the release core, one test at a time (timings and
// process memory are this machine's, with nothing else of ours running),
// and long timeouts, since the gate in each, not the timeout, judges a slow
// case. Not run in CI. See docs/reference/benchmarks.md.
//
//     pnpm run bench                                  # every suite
//     pnpm run bench documents                        # one file
//     BENCH_GATE=off BENCH_REPS=3 pnpm run bench
//     SOAK_MINUTES=60 pnpm run bench soak
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4180;
process.env.LC_CORE_BUILD = 'release';
// Not under test-results/, which Playwright empties at the start of every run.
process.env.BENCH_OUT ??= path.resolve(import.meta.dirname, '.bench');
process.env.BENCH_COMMIT ??= (() => {
    try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- the developer's own git
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
})();

export default defineConfig({
    testDir: 'test/bench',
    testMatch: '*.bench.ts',
    globalSetup: './test/bench/globalSetup.ts',
    workers: 1,
    retries: 0,
    timeout: 60 * 60_000,
    reporter: [['list']],
    use: { trace: 'off' },
    expect: { timeout: 120_000 },
    webServer: {
        command: 'node test/e2e/server.mjs',
        env: { PORT: String(PORT) },
        url: `http://127.0.0.1:${String(PORT)}/project/ready`,
        reuseExistingServer: false,
    },
});
