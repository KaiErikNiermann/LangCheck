// The extension's background (service worker in Chrome, event page in
// Firefox). Content scripts connect over a runtime port; each request is
// re-parsed and handed to the native connection of the workspace the
// browser says the sending tab is on. Panel messages on the same port go to
// the panel tabs (panels.ts), which connect on a port of their own.
import browser, { type Runtime } from 'webextension-polyfill';
import { BACKGROUND_PORT_NAME, parseBackgroundRequest, type BackgroundResponse } from '../messaging/background';
import { forPage } from './forPage';
import { CONFIG_PORT_NAME, parseConfigPageRequest } from '../messaging/config';
import { isKeepalive } from '../messaging/keepalive';
import { PANEL_PORT_NAME, parsePageToPanel } from '../messaging/webview';
import { workspaceForUrl } from '../sites/registry';
import { CoreManager, IDLE_CLOSE_MS } from './nativeCore';
import { ConfigTabs } from './configTabs';
import { OpenBudget } from './openBudget';
import { Panels } from './panels';
import { WorkspacePages } from './workspacePages';

const cores = new CoreManager((host) => browser.runtime.connectNative(host));
setInterval(() => { cores.sweep(); }, IDLE_CLOSE_MS / 4);

/** Where the config tabs are kept across a restart of this worker (storage.session). */
const CONFIG_TABS_KEY = 'configTabs';

/** Every tab the extension opens for a page comes out of one budget per source tab. */
const budget = new OpenBudget();

/** Brings a tab, and its window, forward. */
async function activate(tabId: number): Promise<void> {
    const tab = await browser.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
}

const panels = new Panels({
    create: (options) => browser.tabs.create(options),
    activate,
    // tabs.get and windows.get need no permission for these fields.
    isFrontmost: async (tabId) => {
        const tab = await browser.tabs.get(tabId);
        if (!tab.active || tab.windowId === undefined) return false;
        const window = await browser.windows.get(tab.windowId);
        return window.focused;
    },
    remove: (tabId) => browser.tabs.remove(tabId),
    pageUrl: (viewType) => browser.runtime.getURL(`webview/${viewType}.html`),
}, undefined, budget);
const configTabs = new ConfigTabs({
    create: (options) => browser.tabs.create(options),
    activate,
    url: browser.runtime.getURL('config.html'),
}, budget, (tabs) => {
    void browser.storage.session.set({ [CONFIG_TABS_KEY]: tabs }).catch(() => {});
});

/**
 * The config tabs kept across a restart of this worker, put back before any
 * config page is served: those whose tab is still open. Without it a config
 * page that outlived the worker could never save again.
 */
const configTabsRestored: Promise<void> = browser.storage.session
    .get(CONFIG_TABS_KEY)
    .then(async (stored) => {
        const kept = stored[CONFIG_TABS_KEY];
        if (!Array.isArray(kept)) return;
        const entries = kept.filter((e): e is [number, string] => Array.isArray(e) && Number.isSafeInteger(e[0]) && typeof e[1] === 'string');
        const open = await Promise.all(entries.map(([tab]) => browser.tabs.get(tab).then(() => true, () => false)));
        configTabs.restore(entries.filter((_, i) => open[i] === true));
    })
    .catch(() => {});

browser.tabs.onRemoved.addListener((tabId) => {
    panels.tabRemoved(tabId);
    configTabs.tabRemoved(tabId);
});

/** Each workspace's open pages, to tell them its config changed. */
const pagesOf = new WorkspacePages<Runtime.Port>();

/** After a config write: the core re-reads the config, then every page on the workspace re-checks. */
async function configChanged(workspace: string): Promise<void> {
    await cores.reinitialize(workspace);
    for (const page of pagesOf.of(workspace)) {
        try {
            page.postMessage({ reload: true });
        } catch {
            // That page went away meanwhile.
        }
    }
}

/** The config page's port: ours, in a tab this side opened for one workspace, and nothing else may send its requests. */
function serveConfigPage(port: Runtime.Port): void {
    if (!ours(port) || port.sender?.url?.startsWith(browser.runtime.getURL('config.html')) !== true) {
        port.disconnect();
        return;
    }
    const tabId = port.sender.tab?.id;
    const known = configTabsRestored.then(() => configTabs.workspaceOf(tabId));
    void known.then((workspace) => {
        if (workspace === undefined) port.disconnect();
    });
    // Messages wait for the restore, in the order they came.
    port.onMessage.addListener((message: unknown) => {
        // Its arrival kept this background running; there is nothing to answer.
        if (isKeepalive(message)) return;
        void known.then((workspace) => {
            if (workspace !== undefined) serveConfigRequest(port, workspace, message);
        });
    });
}

function serveConfigRequest(port: Runtime.Port, workspace: string, message: unknown): void {
    const parsed = parseConfigPageRequest(message);
    if (parsed === undefined) return;
    void cores.request(workspace, parsed, true).then(async (response) => {
        try {
            port.postMessage({ id: parsed.id, response });
        } catch {
            // The config page closed while the core was answering.
        }
        if ('writeConfig' in parsed.request && response.ok) await configChanged(workspace);
    });
}

declare const __LANGUAGE_CHECK_TEST__: boolean;
if (__LANGUAGE_CHECK_TEST__) {
    // The e2e memory tests read what the background holds: it must drain
    // when the tabs that made it go away. Test builds only.
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- test builds only, see above
    (globalThis as { __lcBackground?: unknown }).__lcBackground = { panels: () => panels.size, configTabs: () => configTabs.size, connections: () => cores.size, pages: () => pagesOf.size };
}

const ours = (port: Runtime.Port): boolean => port.sender?.id === browser.runtime.id && port.sender.tab?.id !== undefined;

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
    if (port.name === CONFIG_PORT_NAME) {
        serveConfigPage(port);
        return;
    }
    if (port.name === PANEL_PORT_NAME) {
        // A panel page: one of ours, in a tab this side opened.
        const fromPanelPage = ours(port) && port.sender?.url?.startsWith(browser.runtime.getURL('webview/')) === true;
        const panel = fromPanelPage ? panels.panelConnected(port.sender?.tab?.id, port) : undefined;
        if (panel === undefined) {
            port.disconnect();
            return;
        }
        port.onMessage.addListener((message: unknown) => {
            // Its arrival kept this background running; it is not for the page.
            if (!isKeepalive(message)) panel.message(message);
        });
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
    // Registered now, not once the workspace is known: a port that goes
    // before then would otherwise stay among its workspace's pages.
    const leave = pagesOf.add(port, workspace);
    port.onDisconnect.addListener(() => {
        leave();
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
        if (parsed?.op === 'openConfig') configTabs.open(tabId, key, windowId);
        else if (parsed !== undefined) panels.fromPage(tabId, port, parsed, windowId);
        return;
    }
    const parsed = parseBackgroundRequest(message);
    if (parsed === undefined) return;
    void cores.request(key, parsed.request).then((response) => {
        const reply: BackgroundResponse = { id: parsed.id, response: forPage(response) };
        try {
            port.postMessage(reply);
        } catch {
            // The tab went away while the core was answering.
        }
    });
}
