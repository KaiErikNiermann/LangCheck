// The page-world side of the extension, for one site: connect to the content
// script, activate the checking feature against the shim, and keep the
// site's editor joined. Everything here runs in the page's realm, next to
// the site's own scripts, and trusts nothing it reads from the page beyond
// what it needs to draw.
import * as vscode from 'vscode';
import { startClient, type ClientStats, type PageFiles } from './client';
import { SITES } from '../sites/catalog';
import { connectCore } from '../messaging/pageClient';
import type { SitePage, SiteWorkspace } from '../sites/site';
import { Bridge } from './bridge';
import { notOpenedMessage, webviewHost } from './webviewHost';
import { host } from '../shim/vscode';

interface Running {
    readonly bridge: Bridge;
    stats(): ClientStats & { readonly panels: number };
    stop(): void;
}

declare const __LANGUAGE_CHECK_VERSION__: string;

declare global {
    // The running instance, so a newer build injected over it (development)
    // replaces it instead of running beside it, and tests can read its state.
    var __languageCheck: Running | undefined;
}

/** What a client not started yet reports. */
const notStarted = (): ClientStats => ({ checks: 0, findings: 0, documents: 0 });

/** How often the page's URL is looked at for a move to another workspace (single-page apps). */
const WATCH_MS = 1000;

/**
 * Runs the extension for the workspace the URL names, and follows the URL:
 * single-page apps (Notion) move between pages, and between workspaces,
 * without a load. A page that names no workspace yet is waited on; a move
 * to another workspace restarts the client for it (its dictionary, its
 * native connection).
 */
export function startPage(site: SitePage, workspace: SiteWorkspace): void {
    let running: string | undefined;
    const follow = (): void => {
        const project = workspace.projectFromPath(location.pathname);
        if (project === running) return;
        running = project;
        globalThis.__languageCheck?.stop();
        if (project !== undefined) start(site, project);
    };
    follow();
    setInterval(follow, WATCH_MS);
}

function start(site: SitePage, project: string): void {
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
    const webviews = webviewHost(core, (what, reason) => {
        void vscode.window.showErrorMessage(notOpenedMessage(what, reason));
    });
    host.webviews = webviews.open;
    host.focusPage = webviews.focusPage;
    const bridge = new Bridge(site, project);
    const files: PageFiles = {
        siteName: SITES.find((entry) => entry.id === site.id)?.name ?? site.id,
        site: site.files?.(),
        documentPath: (fsPath) => bridge.documentPath(fsPath),
    };
    let clientStats = notStarted;
    let stopped = false;
    // Started once the content script has answered, with the checking
    // settings, so the first check is planned under them (or once it never
    // will, so the client can say the checker cannot be reached).
    void core.ready.then(() => {
        if (!stopped) clientStats = startClient(context, core, files, site.dictionary?.());
    });
    // Palette commands run like VS Code's: through the command registry.
    core.onCommand((id) => {
        void vscode.commands.executeCommand(id).then(undefined, (error: unknown) => {
            console.error('[language-check]', error);
        });
    });

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the one deliberate global, see `declare global` above
    globalThis.__languageCheck = {
        bridge,
        stats: () => ({ ...clientStats(), panels: webviews.openCount() }),
        stop() {
            stopped = true;
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
