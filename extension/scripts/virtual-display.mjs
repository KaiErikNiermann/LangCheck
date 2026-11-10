#!/usr/bin/env node
/**
 * Run a command that opens VS Code windows on a virtual X display.
 *
 * Usage: node scripts/virtual-display.mjs <command> [args...]
 *
 * The e2e suites launch real VS Code (Electron) windows. On Linux they go to
 * a throwaway Xvfb display, so a local run does not open windows on top of
 * the developer's desktop. WAYLAND_DISPLAY is dropped as well: Electron
 * prefers Wayland whenever that variable is set, and would then open on the
 * real session despite DISPLAY pointing at Xvfb.
 *
 * Set LANGCHECK_E2E_HEADED=1 to watch the windows instead. Outside Linux
 * there is no Xvfb, and the command runs as given.
 */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
    console.error('usage: virtual-display.mjs <command> [args...]');
    process.exit(2);
}

const headed = process.env.LANGCHECK_E2E_HEADED === '1' || process.platform !== 'linux';

function run(file, argv, env) {
    const child = spawn(file, argv, { stdio: 'inherit', env });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => child.kill(signal));
    }
    child.on('exit', (code, signal) => {
        process.exitCode = code ?? (signal ? 128 : 1);
    });
}

if (headed) {
    run(command, args, process.env);
} else {
    if (spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error) {
        console.error(
            'xvfb-run was not found, so the e2e windows would open on your desktop.\n'
            + 'Install Xvfb (Arch: xorg-server-xvfb, Debian/Ubuntu: xvfb), or set\n'
            + 'LANGCHECK_E2E_HEADED=1 to run with visible windows.',
        );
        process.exit(127);
    }
    const env = { ...process.env, XDG_SESSION_TYPE: 'x11' };
    delete env.WAYLAND_DISPLAY;
    run('xvfb-run', ['-a', command, ...args], env);
}
