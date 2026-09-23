/**
 * Which core binary to run, and getting it onto disk when it is missing.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { executeCommand, COMMANDS } from '../commands/ids';
import { getSetting } from '../config/settings';
import type { Logger } from '../shared/logger';
import { openReleasesPage } from '../shared/links';
import { binaryExists, downloadBinary } from './downloader';

/**
 * Whether the core is a local build rather than a downloaded one.
 *
 * Test counts with Development, and has to: `resolveBinaryPath` returns a path
 * under rust-core/target in both modes, so a download into `bin/` installs a
 * binary the test run then never opens. It is not merely wasted -- it puts an
 * unauthenticated api.github.com call in front of every one of the end-to-end
 * launches, and a release whose assets are still uploading, or a rate-limited
 * runner, failed all of them at once.
 */
export function usesLocalBuild(context: vscode.ExtensionContext): boolean {
    return context.extensionMode === vscode.ExtensionMode.Development
        || context.extensionMode === vscode.ExtensionMode.Test;
}

/** Where a downloaded core lives. */
export function binDir(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'bin');
}

export function resolveBinaryPath(context: vscode.ExtensionContext, channel?: string): string {
    const customPath = getSetting('core.binaryPath');
    if (customPath) return customPath;

    const selectedChannel = channel ?? getSetting('core.channel');

    // Test counts as development here. The end-to-end tests run under
    // ExtensionMode.Test, where the packaged `bin/` directory exists only
    // in a release build -- so without this they would check nothing and
    // pass, which is the failure mode they were written to catch.
    if (usesLocalBuild(context)) {
        // Dev runs straight out of rust-core/target. Prefer the profile the
        // channel asks for, but fall back to the other one: a checkout that
        // only ran `cargo build` has no target/release, and pointing at a
        // path that doesn't exist takes the core down for the whole session.
        const targetDir = path.join(context.extensionPath, '..', 'rust-core', 'target');
        const profiles = selectedChannel === 'debug' ? ['debug', 'release'] : ['release', 'debug'];
        const candidates = profiles.map(p => path.join(targetDir, p, 'language-check-server'));
        return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]!;
    }

    switch (selectedChannel) {
        case 'canary':
            return path.join(context.extensionPath, 'bin', 'language-check-server-canary');
        case 'dev':
            return path.join(context.extensionPath, 'bin', 'language-check-server-dev');
        default:
            return path.join(context.extensionPath, 'bin', 'language-check-server');
    }
}

/** Download the release core into `bin/`, with a progress notification. */
export async function downloadWithProgress(
    context: vscode.ExtensionContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Language Check'),
            cancellable: false,
        },
        async (progress) => {
            try {
                await downloadBinary(binDir(context), progress, context.extension.packageJSON.version);
                return { ok: true as const };
            } catch (err) {
                return { ok: false as const, error: String(err) };
            }
        },
    );
}

/** The message offered when a download fails, and what its two buttons do. */
export function downloadFailedMessage(error: string): Thenable<string | undefined> {
    return vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to install core binary: {0}', error),
        vscode.l10n.t('Retry'),
        vscode.l10n.t('Download Manually'),
    );
}

export function onDownloadFailedChoice(selection: string | undefined): void {
    if (selection === vscode.l10n.t('Retry')) {
        executeCommand(COMMANDS.downloadBinary);
    } else if (selection === vscode.l10n.t('Download Manually')) {
        openReleasesPage();
    }
}

/**
 * Make sure there is a core to run, then boot it.
 *
 * In development and test modes, the binary is whatever `cargo build` left in
 * rust-core/target, so a missing one is a build step that was skipped. In
 * production it is downloaded from GitHub Releases if missing -- similar to how
 * the Lean 4 extension bootstraps its server.
 *
 * Returns a promise only when there is a download to wait for. The other paths
 * finish synchronously, and activation must not yield on them: the rest of
 * activate() registers the triggers that the boot's first check relies on.
 */
export function bootstrapCore(
    context: vscode.ExtensionContext,
    log: Logger,
    boot: () => Promise<void>,
): Promise<void> | undefined {
    if (usesLocalBuild(context)) {
        const localBinaryPath = resolveBinaryPath(context);
        if (!fs.existsSync(localBinaryPath)) {
            const target = getSetting('core.channel') === 'debug' ? 'debug' : 'release';
            log.error('Local core binary not found', { expected: localBinaryPath });
            // Not awaited. Nothing dismisses a notification in a test run, and
            // an activation that waits for a click never returns -- which is
            // how a missing binary turned into every suite timing out in its
            // `suiteSetup` with a message that named neither the binary nor
            // the reason.
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'Language Check: core binary not found. Build it with `cargo build{0}` in rust-core/, or download a release.',
                    target === 'release' ? ' --release' : '',
                ),
                vscode.l10n.t('Download Release'),
            ).then(selection => {
                if (selection === vscode.l10n.t('Download Release')) {
                    openReleasesPage();
                }
            });
        } else {
            boot();
        }
        return undefined;
    }
    if (!binaryExists(binDir(context))) {
        return (async () => {
            const result = await downloadWithProgress(context);
            if (result.ok) {
                boot();
            } else {
                // Not awaited, for the same reason as above: activation reports
                // the failure and finishes. Waiting on the click left the
                // extension stuck in `activate` with no core and no way to retry.
                void downloadFailedMessage(result.error).then(onDownloadFailedChoice);
            }
        })();
    }
    boot();
    return undefined;
}
