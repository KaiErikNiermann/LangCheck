// The page-world side of the extension, for one site: connect to the content
// script, activate the checking feature against the shim, and keep the
// site's editor joined. Everything here runs in the page's realm, next to
// the site's own scripts, and trusts nothing it reads from the page beyond
// what it needs to draw.
import * as vscode from 'vscode';
import { startClient, type ClientStats } from './client';
import { connectCore } from '../messaging/pageClient';
import type { SitePage, SiteWorkspace } from '../sites/site';
import { Bridge } from './bridge';
import { webviewHost } from './webviewHost';
import { host } from '../shim/vscode';

interface Running {
    readonly bridge: Bridge;
    stats(): ClientStats;
    stop(): void;
}

declare const __LANGUAGE_CHECK_VERSION__: string;

declare global {
    // The running instance, so a newer build injected over it (development)
    // replaces it instead of running beside it, and tests can read its state.
    var __languageCheck: Running | undefined;
}

export function startPage(site: SitePage, workspace: SiteWorkspace): void {
    const project = workspace.projectFromPath(location.pathname);
    if (project === undefined) return;
    globalThis.__languageCheck?.stop();

    const core = connectCore();
    const subscriptions: { dispose(): unknown }[] = [];
    const context: vscode.ExtensionContext = {
        subscriptions,
        // No directory on disk: webview assets are the extension's own pages.
        extensionPath: '',
        extensionUri: vscode.Uri.parse('extension:/'),
        extension: { id: 'language-check-web', packageJSON: { version: __LANGUAGE_CHECK_VERSION__ } },
    };
    const webviews = webviewHost(core);
    host.webviews = webviews.open;
    host.focusPage = webviews.focusPage;
    const stats = startClient(context, core);
    const bridge = new Bridge(site, project);
    // Palette commands run like VS Code's: through the command registry.
    core.onCommand((id) => {
        void vscode.commands.executeCommand(id).then(undefined, (error: unknown) => {
            console.error('[language-check]', error);
        });
    });

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the one deliberate global, see `declare global` above
    globalThis.__languageCheck = {
        bridge,
        stats,
        stop() {
            bridge.stop();
            for (const s of subscriptions) s.dispose();
            webviews.closeAll();
            host.webviews = undefined;
            host.focusPage = undefined;
            core.dispose();
            // eslint-disable-next-line unicorn/no-global-object-property-assignment -- clearing the same global
            globalThis.__languageCheck = undefined;
        },
    };
}
