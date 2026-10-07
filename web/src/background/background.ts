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
    // site. The workspace is fixed here, from what the browser reports.
    const key = workspaceForUrl(port.sender?.url);
    const tab = port.sender?.tab;
    if (key === undefined || port.name !== BACKGROUND_PORT_NAME || !ours(port) || tab?.id === undefined) {
        port.disconnect();
        return;
    }
    const tabId = tab.id;
    port.onDisconnect.addListener(() => { panels.sourceGone(tabId, port); });
    port.onMessage.addListener((message: unknown) => {
        const webview = (message as { webview?: unknown } | null)?.webview;
        if (webview !== undefined) {
            const parsed = parsePageToPanel(webview);
            if (parsed !== undefined) panels.fromPage(tabId, port, parsed, tab.windowId);
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
    });
});
