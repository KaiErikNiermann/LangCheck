// The background's half of the webview panels: each panel a page opens is the
// client's webview app in an extension tab beside it. Panels are keyed by the
// opening tab, so one tab can only reach its own; a panel tab is recognised by
// the tab id this side created, never by anything the tab says.
//
// Lifetimes: closing the panel tab reports `closed` to the page; the page's
// content script going away (navigation, tab closed) closes its panels.
import { isBoundedMessage, WEBVIEW_TYPE, type PageToPanel, type PanelToPage, type ViewType } from '../messaging/webview';

/** Messages kept for a panel tab that has not connected yet (its app is loading). */
export const MAX_QUEUED = 256;

/** A runtime port, as far as the panels use it. */
export interface PanelPort {
    postMessage(message: unknown): void;
    disconnect(): void;
}

/** The tab and window calls the panels make (browser.tabs/windows, or a fake). */
export interface TabsApi {
    create(options: { url: string; openerTabId: number; windowId?: number }): Promise<{ id?: number; windowId?: number }>;
    activate(tabId: number): Promise<void>;
    remove(tabId: number): Promise<void>;
    pageUrl(viewType: ViewType): string;
}

interface Panel {
    readonly id: string;
    readonly source: number;
    tab: number | undefined;
    port: PanelPort | undefined;
    readonly queue: unknown[];
    closed: boolean;
}

const key = (source: number, panel: string): string => `${String(source)}:${panel}`;
/** For tab calls whose failure changes nothing: the tab is already gone. */
const ignore = (): void => {};

export class Panels {
    private readonly panels = new Map<string, Panel>();
    private readonly byTab = new Map<number, Panel>();
    private readonly sources = new Map<number, PanelPort>();

    constructor(private readonly tabs: TabsApi) {}

    /** A message from the content script of `source` (a tab id), over `port`. */
    fromPage(source: number, port: PanelPort, message: PageToPanel, windowId?: number): void {
        this.sources.set(source, port);
        if (message.op === 'focusEditor') {
            void this.tabs.activate(source).catch(ignore);
            return;
        }
        const existing = this.panels.get(key(source, message.panel));
        switch (message.op) {
            case 'open':
                if (existing === undefined) this.open(source, message.panel, message.viewType, windowId);
                return;
            case 'post':
                if (existing !== undefined) this.deliver(existing, message.message);
                return;
            case 'reveal':
                if (existing?.tab !== undefined) void this.tabs.activate(existing.tab).catch(ignore);
                return;
            case 'close':
                if (existing !== undefined) this.close(existing, false);
                return;
        }
    }

    /** The content script of `source` disconnected: its page is gone, and so are its panels. */
    sourceGone(source: number, port: PanelPort): void {
        if (this.sources.get(source) !== port) return;
        this.sources.delete(source);
        // Deleting from a Map while iterating it is defined: the loop sees the rest.
        for (const panel of this.panels.values()) if (panel.source === source) this.close(panel, false);
    }

    /**
     * A panel tab connected. Returns the handler for its messages and its
     * disconnect, or `undefined` (and disconnects it) when the tab is not one
     * this side opened.
     */
    panelConnected(tab: number | undefined, port: PanelPort): { message(value: unknown): void; gone(): void } | undefined {
        const panel = tab === undefined ? undefined : this.byTab.get(tab);
        if (panel === undefined || panel.port !== undefined || panel.closed) {
            port.disconnect();
            return undefined;
        }
        panel.port = port;
        for (const queued of panel.queue.splice(0)) port.postMessage(queued);
        return {
            message: (value) => {
                if (panel.closed || !isBoundedMessage(value)) return;
                this.toPage(panel, { type: WEBVIEW_TYPE, op: 'message', panel: panel.id, message: value });
            },
            gone: () => {
                if (!panel.closed) this.close(panel, true);
            },
        };
    }

    /** A tab was closed (any tab: only panel tabs matter here). */
    tabRemoved(tab: number): void {
        const panel = this.byTab.get(tab);
        if (panel !== undefined) this.close(panel, true);
    }

    get size(): number {
        return this.panels.size;
    }

    private open(source: number, id: string, viewType: ViewType, windowId: number | undefined): void {
        const panel: Panel = { id, source, tab: undefined, port: undefined, queue: [], closed: false };
        this.panels.set(key(source, id), panel);
        void this.tabs
            .create({ url: this.tabs.pageUrl(viewType), openerTabId: source, ...(windowId !== undefined && { windowId }) })
            .then((tab) => {
                if (tab.id === undefined) throw new Error('no tab');
                panel.tab = tab.id;
                if (panel.closed) void this.tabs.remove(tab.id).catch(ignore);
                else this.byTab.set(tab.id, panel);
            })
            .catch(() => {
                if (!panel.closed) this.close(panel, true);
            });
    }

    /** Sends `message` to the panel's tab, or keeps it until the tab connects. */
    private deliver(panel: Panel, message: unknown): void {
        if (panel.port !== undefined) {
            panel.port.postMessage(message);
            return;
        }
        panel.queue.push(message);
        if (panel.queue.length > MAX_QUEUED) panel.queue.shift();
    }

    /** Forget `panel`, close its tab, and tell the page when the page did not ask for it. */
    private close(panel: Panel, tellPage: boolean): void {
        panel.closed = true;
        this.panels.delete(key(panel.source, panel.id));
        if (panel.tab !== undefined) {
            this.byTab.delete(panel.tab);
            void this.tabs.remove(panel.tab).catch(ignore);
        }
        panel.queue.length = 0;
        if (tellPage) this.toPage(panel, { type: WEBVIEW_TYPE, op: 'closed', panel: panel.id });
    }

    private toPage(panel: Panel, message: PanelToPage): void {
        try {
            this.sources.get(panel.source)?.postMessage({ webview: message });
        } catch {
            // The page's content script went away; sourceGone follows.
        }
    }
}
