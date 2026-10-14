// The shim's webview panels on the web: each panel is the client's own
// webview app (SpeedFix, Inspector) in an extension tab. This side names the
// panel, forwards the client's postMessage calls, and hands back what the
// tab sends and when it closes; the content script and background carry it.
import type { WebviewChannel, WebviewOpener } from '../shim/vscode';
import type { CoreClient } from '../messaging/pageClient';
import { VIEW_TYPES, WEBVIEW_TYPE, type NotOpenedReason, type ViewType } from '../messaging/webview';

interface Listeners {
    readonly viewType: ViewType;
    readonly message: ((message: unknown) => void)[];
    readonly close: (() => void)[];
}

/** What did not open: a panel, or the workspace's config page. */
export type NotOpened = ViewType | 'config';

const TITLE: Readonly<Record<NotOpened, string>> = { speedFix: 'SpeedFix', inspector: 'The Inspector', config: 'The config page' };
const BECAUSE: Readonly<Record<NotOpenedReason, string>> = {
    busy: 'this page opened too many tabs in the last minute; try again shortly',
    failed: 'the browser would not open a tab for it (details in the extension console)',
};

/** The sentence the user is shown when `what` did not open. */
export function notOpenedMessage(what: NotOpened, reason: NotOpenedReason): string {
    return `${TITLE[what]} did not open: ${BECAUSE[reason]}.`;
}

/** Opens panels for the shim, and closes every one still open when the page's client stops. */
export interface WebviewHost {
    readonly open: WebviewOpener;
    /** Brings the page's tab in front of its panels. */
    readonly focusPage: () => void;
    readonly closeAll: () => void;
    /** Panels open now (for the page's stats). */
    readonly openCount: () => number;
}

/** `notOpened` hears of a tab the page asked for that did not open, to tell the user. */
export function webviewHost(core: CoreClient, notOpened: (what: NotOpened, reason: NotOpenedReason) => void = () => {}): WebviewHost {
    const panels = new Map<string, Listeners>();
    let next = 1;

    core.onWebview((event) => {
        if (event.op === 'configNotOpened') {
            notOpened('config', event.reason);
            return;
        }
        const listeners = panels.get(event.panel);
        if (listeners === undefined) return;
        if (event.op === 'message') {
            for (const listener of listeners.message) listener(event.message);
            return;
        }
        panels.delete(event.panel);
        if (event.reason !== undefined) notOpened(listeners.viewType, event.reason);
        for (const listener of listeners.close) listener();
    });

    const open: WebviewOpener = (viewType): WebviewChannel => {
        if (!(VIEW_TYPES as readonly string[]).includes(viewType)) throw new Error(`no web panel for ${viewType}`);
        const panel = `p${String(next++)}`;
        const listeners: Listeners = { viewType: viewType as ViewType, message: [], close: [] };
        panels.set(panel, listeners);
        core.post({ type: WEBVIEW_TYPE, op: 'open', panel, viewType: viewType as ViewType });
        return {
            post: (message) => {
                core.post({ type: WEBVIEW_TYPE, op: 'post', panel, message });
            },
            onMessage: (listener) => {
                listeners.message.push(listener);
            },
            onClose: (listener) => {
                listeners.close.push(listener);
            },
            reveal: () => {
                core.post({ type: WEBVIEW_TYPE, op: 'reveal', panel });
            },
            close: () => {
                if (!panels.delete(panel)) return;
                core.post({ type: WEBVIEW_TYPE, op: 'close', panel });
            },
        };
    };
    return {
        open,
        focusPage: () => {
            core.post({ type: WEBVIEW_TYPE, op: 'focusEditor' });
        },
        closeAll: () => {
            for (const panel of panels.keys()) core.post({ type: WEBVIEW_TYPE, op: 'close', panel });
            panels.clear();
        },
        openCount: () => panels.size,
    };
}
