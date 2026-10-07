// Runs in a panel tab before the webview app: stands in for the VS Code
// webview host. `acquireVsCodeApi()` posts to the background (and on to the
// page that owns the panel); what the page posts arrives as the window
// `message` events the app listens for. Messages that arrive before the app
// has said anything (its `ready`) are held, since it may not be listening yet.
import browser from 'webextension-polyfill';
import { PANEL_PORT_NAME } from '../messaging/webview';

/** Held messages, at most: the page queues no more than this per panel either. */
const MAX_HELD = 256;
const STATE_KEY = 'language-check-webview-state';

const port = browser.runtime.connect({ name: PANEL_PORT_NAME });
const state = { appListening: false, acquired: false };
const held: unknown[] = [];

const deliver = (data: unknown): void => {
    globalThis.dispatchEvent(new MessageEvent('message', { data }));
};

port.onMessage.addListener((message: unknown) => {
    if (state.appListening) {
        deliver(message);
        return;
    }
    held.push(message);
    if (held.length > MAX_HELD) held.shift();
});
// The background closed the panel, or went away with the page's port: either
// way there is nothing on the other end any more.
port.onDisconnect.addListener(() => { globalThis.close(); });

const api = {
    postMessage(message: unknown): void {
        port.postMessage(message);
        if (state.appListening) return;
        state.appListening = true;
        for (const queued of held.splice(0)) deliver(queued);
    },
    getState(): unknown {
        try {
            const saved = sessionStorage.getItem(STATE_KEY);
            return saved === null ? undefined : JSON.parse(saved);
        } catch {
            return undefined;
        }
    },
    setState<T>(state: T): T {
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch {
            // Storage refused (full, or disabled): state lasts as long as the page.
        }
        return state;
    },
};

// eslint-disable-next-line unicorn/no-global-object-property-assignment -- the webview host's one global, which the apps call
(globalThis as { acquireVsCodeApi?: () => typeof api }).acquireVsCodeApi = () => {
    // As in VS Code: one app per page, so a second call is a bug.
    if (state.acquired) throw new Error('An instance of the VS Code API has already been acquired');
    state.acquired = true;
    return api;
};
