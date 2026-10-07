// Builds what the end-to-end tests run: the core's server and native host
// (debug, as the Rust integration tests use them) and the extension's test
// build with the fake site pages.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const WEB = path.resolve(import.meta.dirname, '../..');
export const RUST_CORE = path.resolve(WEB, '../rust-core');
export const EXTENSION_ROOT = path.resolve(WEB, '../extension');

// cargo and node from PATH: this is the developer's own toolchain, as when
// they run the tests by hand.
export default function globalSetup(): void {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
    execFileSync('cargo', ['build', '--bin', 'language-check-server', '--bin', 'language-check-native-host'], { cwd: RUST_CORE, stdio: 'inherit' });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
    execFileSync('node', ['esbuild.mjs', '--test'], { cwd: WEB, stdio: 'inherit' });
}
