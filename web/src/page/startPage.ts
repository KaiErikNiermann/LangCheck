// The page-world side of the extension, for one site: connect to the content
// script, activate the checking feature against the shim, and keep the
// site's editor joined. Everything here runs in the page's realm, next to
// the site's own scripts, and trusts nothing it reads from the page beyond
// what it needs to draw.
import type * as vscode from 'vscode';
import { activate } from '../feature/checkFeature';
import { connectCore } from '../messaging/pageClient';
import { LANGUAGE_IDS, type LanguageId } from '../messaging/protocol';
import { projectFromProjectPath, type SitePage } from '../sites/site';
import { Bridge } from './bridge';

interface Running {
    readonly bridge: Bridge;
    stop(): void;
}

declare global {
    // The running instance, so a newer build injected over it (development)
    // replaces it instead of running beside it, and tests can read its state.
    var __languageCheck: Running | undefined;
}

export function startPage(site: SitePage): void {
    const project = projectFromProjectPath(location.pathname);
    if (project === undefined) return;
    globalThis.__languageCheck?.stop();

    const core = connectCore();
    const subscriptions: { dispose(): unknown }[] = [];
    const context: vscode.ExtensionContext = { subscriptions };
    const languageOf = (doc: vscode.TextDocument): LanguageId =>
        (LANGUAGE_IDS as readonly string[]).includes(doc.languageId) ? (doc.languageId as LanguageId) : 'plaintext';
    activate(context, core, languageOf);
    const bridge = new Bridge(site, project);

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the one deliberate global, see `declare global` above
    globalThis.__languageCheck = {
        bridge,
        stop() {
            bridge.stop();
            for (const s of subscriptions) s.dispose();
            core.dispose();
            // eslint-disable-next-line unicorn/no-global-object-property-assignment -- clearing the same global
            globalThis.__languageCheck = undefined;
        },
    };
}
