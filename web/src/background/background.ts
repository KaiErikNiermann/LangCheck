// The extension's background (service worker in Chrome, event page in
// Firefox). Content scripts connect over a runtime port; each request is
// re-parsed and handed to the native connection of the workspace the
// browser says the sending tab is on. Panel messages on the same port go to
// the panel tabs (panels.ts), which connect on a port of their own.
import browser, { type Runtime } from 'webextension-polyfill';
import { BACKGROUND_PORT_NAME, parseBackgroundRequest, type BackgroundResponse } from '../messaging/background';
import { PANEL_PORT_NAME, parsePageToPanel } from '../messaging/webview';
import { workspaceForUrl } from '../sites/registry';
import { CoreManager, IDLE_CLOSE_MS } from './nativeCore';
import { Panels } from './panels';

const cores = new CoreManager((host) => browser.runtime.connectNative(host));
setInterval(() => { cores.sweep(); }, IDLE_CLOSE_MS / 4);

const panels = new Panels({
    create: (options) => browser.tabs.create(options),
    activate: async (tabId) => {
        const tab = await browser.tabs.update(tabId, { active: true });
        if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    },
    // tabs.get and windows.get need no permission for these fields.
    isFrontmost: async (tabId) => {
        const tab = await browser.tabs.get(tabId);
        if (!tab.active || tab.windowId === undefined) return false;
        const window = await browser.windows.get(tab.windowId);
        return window.focused;
    },
    remove: (tabId) => browser.tabs.remove(tabId),
    pageUrl: (viewType) => browser.runtime.getURL(`webview/${viewType}.html`),
});
browser.tabs.onRemoved.addListener((tabId) => { panels.tabRemoved(tabId); });

declare const __LANGUAGE_CHECK_TEST__: boolean;
if (__LANGUAGE_CHECK_TEST__) {
    // The e2e memory tests read what the background holds: it must drain
    // when the tabs that made it go away. Test builds only.
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- test builds only, see above
    (globalThis as { __lcBackground?: unknown }).__lcBackground = { panels: () => panels.size, connections: () => cores.size };
}

const ours = (port: Runtime.Port): boolean => port.sender?.id === browser.runtime.id && port.sender.tab?.id !== undefined;

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
    if (port.name === PANEL_PORT_NAME) {
        // A panel page: one of ours, in a tab this side opened.
        const fromPanelPage = ours(port) && port.sender?.url?.startsWith(browser.runtime.getURL('webview/')) === true;
        const panel = fromPanelPage ? panels.panelConnected(port.sender?.tab?.id, port) : undefined;
        if (panel === undefined) {
            port.disconnect();
            return;
        }
        port.onMessage.addListener((message: unknown) => { panel.message(message); });
        port.onDisconnect.addListener(() => { panel.gone(); });
        return;
    }
    // Only our own content scripts, in a tab on a project page of a known
    // site. The workspace is fixed here, from what the browser reports: the
    // tab's current URL, since a single-page app (Notion) moves between
    // workspaces without a load and a port's sender.url stays the URL the
    // page loaded with. The content script opens a new port after a move.
    const tab = port.sender?.tab;
    if (port.name !== BACKGROUND_PORT_NAME || !ours(port) || tab?.id === undefined) {
        port.disconnect();
        return;
    }
    const tabId = tab.id;
    const workspace = browser.tabs
        .get(tabId)
        .then((current) => workspaceForUrl(current.url ?? port.sender?.url))
        // No tab to ask: no URL, so no workspace.
        .catch(() => workspaceForUrl(undefined));
    // Messages wait for the workspace, in the order they came.
    port.onMessage.addListener((message: unknown) => {
        void workspace.then((key) => {
            if (key !== undefined) serveContent(port, tabId, tab.windowId, key, message);
        });
    });
    port.onDisconnect.addListener(() => {
        panels.sourceGone(tabId, port);
    });
    void workspace.then((key) => {
        if (key === undefined) port.disconnect();
    });
});

/** One message from a content script, on `key`'s workspace. */
function serveContent(port: Runtime.Port, tabId: number, windowId: number | undefined, key: string, message: unknown): void {
    const webview = (message as { webview?: unknown } | null)?.webview;
    if (webview !== undefined) {
        const parsed = parsePageToPanel(webview);
        if (parsed !== undefined) panels.fromPage(tabId, port, parsed, windowId);
        return;
    }
    const parsed = parseBackgroundRequest(message);
    if (parsed === undefined) return;
    void cores.request(key, parsed.request).then((response) => {
        const reply: BackgroundResponse = { id: parsed.id, response };
        try {
            port.postMessage(reply);
        } catch {
            // The tab went away while the core was answering.
        }
    });
}
