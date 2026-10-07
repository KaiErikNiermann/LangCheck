// The shim's webview panels on the web: each panel is the client's own
// webview app (SpeedFix, Inspector) in an extension tab. This side names the
// panel, forwards the client's postMessage calls, and hands back what the
// tab sends and when it closes; the content script and background carry it.
import type { WebviewChannel, WebviewOpener } from '../shim/vscode';
import type { CoreClient } from '../messaging/pageClient';
import { VIEW_TYPES, WEBVIEW_TYPE, type ViewType } from '../messaging/webview';

interface Listeners {
    readonly message: ((message: unknown) => void)[];
    readonly close: (() => void)[];
}

/** Opens panels for the shim, and closes every one still open when the page's client stops. */
export interface WebviewHost {
    readonly open: WebviewOpener;
    /** Brings the page's tab in front of its panels. */
    readonly focusPage: () => void;
    readonly closeAll: () => void;
}

export function webviewHost(core: CoreClient): WebviewHost {
    const panels = new Map<string, Listeners>();
    let next = 1;

    core.onWebview((event) => {
        const listeners = panels.get(event.panel);
        if (listeners === undefined) return;
        if (event.op === 'message') {
            for (const listener of listeners.message) listener(event.message);
            return;
        }
        panels.delete(event.panel);
        for (const listener of listeners.close) listener();
    });

    const open: WebviewOpener = (viewType): WebviewChannel => {
        if (!(VIEW_TYPES as readonly string[]).includes(viewType)) throw new Error(`no web panel for ${viewType}`);
        const panel = `p${String(next++)}`;
        const listeners: Listeners = { message: [], close: [] };
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
    };
}
