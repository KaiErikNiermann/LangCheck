// Builds what the benchmarks run: the release core's server and native host
// (what a user installs) and the extension's test build.
import { execFileSync } from 'node:child_process';
import { RUST_CORE, WEB } from '../e2e/globalSetup';

export default function globalSetup(): void {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the developer's own toolchain
    execFileSync('cargo', ['build', '--release', '--bin', 'language-check-server', '--bin', 'language-check-native-host'], { cwd: RUST_CORE, stdio: 'inherit' });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the developer's own toolchain
    execFileSync('node', ['esbuild.mjs', '--test'], { cwd: WEB, stdio: 'inherit' });
}
