// The background's half of the webview panels: each panel a page opens is the
// client's webview app in an extension tab beside it. Panels are keyed by the
// opening tab, so one tab can only reach its own; a panel tab is recognised by
// the tab id this side created, never by anything the tab says.
//
// Lifetimes: closing the panel tab reports `closed` to the page; the page's
// content script going away (navigation, tab closed) closes its panels.
import { OpenBudget } from './openBudget';
import { isBoundedMessage, MAX_PANEL_MESSAGE_CHARS, WEBVIEW_TYPE, type PageToPanel, type PanelToPage, type ViewType } from '../messaging/webview';

/** Messages kept for a panel tab that has not connected yet (its app is loading). */
export const MAX_QUEUED = 256;
/** And their total size, as JSON: two of the largest messages a page may post. */
export const MAX_QUEUED_CHARS = 2 * MAX_PANEL_MESSAGE_CHARS;

// Re-exported: the panel tests read them here.
export { MAX_OPENS, OPEN_WINDOW_MS } from './openBudget';

/** A runtime port, as far as the panels use it. */
export interface PanelPort {
    postMessage(message: unknown): void;
    disconnect(): void;
}

/** The tab and window calls the panels make (browser.tabs/windows, or a fake). */
export interface TabsApi {
    create(options: { url: string; openerTabId: number; windowId?: number }): Promise<{ id?: number; windowId?: number }>;
    activate(tabId: number): Promise<void>;
    /** Whether `tabId` is the active tab of the focused window: where the user is. */
    isFrontmost(tabId: number): Promise<boolean>;
    remove(tabId: number): Promise<void>;
    pageUrl(viewType: ViewType): string;
}

interface Panel {
    readonly id: string;
    readonly source: number;
    readonly viewType: ViewType;
    tab: number | undefined;
    port: PanelPort | undefined;
    /** Messages for a tab still loading, with their size as JSON. */
    readonly queue: { readonly message: unknown; readonly chars: number }[];
    queuedChars: number;
    closed: boolean;
}

const key = (source: number, panel: string): string => `${String(source)}:${panel}`;

/** Least time between two tab activations a page asks for, whatever else holds. */
export const MIN_ACTIVATE_INTERVAL_MS = 250;
/** For tab calls whose failure changes nothing: the tab is already gone. */
const ignore = (): void => {};

export class Panels {
    private readonly panels = new Map<string, Panel>();
    private readonly byTab = new Map<number, Panel>();
    private readonly sources = new Map<number, PanelPort>();
    /** When each source tab last had a tab brought forward. */
    private readonly lastActivated = new Map<number, number>();

    /**
     * Opening tabs is bounded twice: one panel per view type at a time, as
     * in VS Code, and the source tab's open budget, shared with the config
     * page, so an open/close loop cannot churn tabs either.
     */
    constructor(
        private readonly tabs: TabsApi,
        private readonly now: () => number = () => performance.now(),
        private readonly budget: OpenBudget = new OpenBudget(now),
    ) {}

    /** A message from the content script of `source` (a tab id), over `port`. */
    fromPage(source: number, port: PanelPort, message: PageToPanel, windowId?: number): void {
        this.sources.set(source, port);
        if (message.op === 'focusEditor') {
            this.focusPage(source);
            return;
        }
        // The background routes this one to the config tabs before it gets here.
        if (message.op === 'openConfig') return;
        const existing = this.panels.get(key(source, message.panel));
        switch (message.op) {
            case 'open':
                if (existing !== undefined) return;
                if (this.mayOpen(source, message.viewType)) this.open(source, message.panel, message.viewType, windowId);
                // Refused: the page's panel learns it will get no tab.
                else this.toSource(source, { type: WEBVIEW_TYPE, op: 'closed', panel: message.panel });
                return;
            case 'post':
                if (existing !== undefined) this.deliver(existing, message.message);
                return;
            case 'reveal':
                // While the user is on the page or the panel already.
                if (existing?.tab !== undefined) void this.activateIf(source, existing.tab, [source, existing.tab]);
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
        // The open budget stays: it belongs to the tab, and a reload (a new
        // content script, a new port) must not refill it.
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
        for (const queued of panel.queue.splice(0)) port.postMessage(queued.message);
        panel.queuedChars = 0;
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
        this.budget.forget(tab);
        this.lastActivated.delete(tab);
        const panel = this.byTab.get(tab);
        if (panel !== undefined) this.close(panel, true);
    }

    get size(): number {
        return this.panels.size;
    }

    /** Whether `source` may open a `viewType` panel now, counting the open if so. */
    private mayOpen(source: number, viewType: ViewType): boolean {
        for (const panel of this.panels.values()) if (panel.source === source && panel.viewType === viewType) return false;
        return this.budget.take(source);
    }

    private open(source: number, id: string, viewType: ViewType, windowId: number | undefined): void {
        const panel: Panel = { id, source, viewType, tab: undefined, port: undefined, queue: [], queuedChars: 0, closed: false };
        this.panels.set(key(source, id), panel);
        void this.tabs
            .create({ url: this.tabs.pageUrl(viewType), openerTabId: source, ...(windowId !== undefined && { windowId }) })
            .then((tab) => {
                if (tab.id === undefined) throw new Error('no tab');
                panel.tab = tab.id;
                if (panel.closed) void this.tabs.remove(tab.id).catch(ignore);
                else this.byTab.set(tab.id, panel);
            })
            .catch((error: unknown) => {
                console.warn(`[language-check] the ${viewType} tab did not open:`, error);
                if (!panel.closed) this.close(panel, true);
            });
    }

    /**
     * Brings the page's tab forward, as a click in one of its panels asks:
     * only while one of them is where the user is, so a page cannot pull its
     * own tab forward.
     */
    private focusPage(source: number): void {
        const panelTabs: number[] = [];
        for (const panel of this.panels.values()) if (panel.source === source && panel.tab !== undefined) panelTabs.push(panel.tab);
        void this.activateIf(source, source, panelTabs);
    }

    /**
     * Brings `target` forward for `source`'s page, only when one of `ifFront`
     * is where the user is, and not more often than MIN_ACTIVATE_INTERVAL_MS:
     * the page world asks, and it is untrusted, so it may move the user's
     * focus only between its own tabs while the user is in them.
     */
    private async activateIf(source: number, target: number, ifFront: readonly number[]): Promise<void> {
        const now = this.now();
        if (now - (this.lastActivated.get(source) ?? -Infinity) < MIN_ACTIVATE_INTERVAL_MS) return;
        // Claimed before the await, so a burst of asks gets one slot, not one each.
        this.lastActivated.set(source, now);
        const front = await Promise.all(ifFront.map((tab) => this.tabs.isFrontmost(tab).catch(() => false)));
        if (front.includes(true)) await this.tabs.activate(target).catch(ignore);
    }

    /** Sends `message` to the panel's tab, or keeps it until the tab connects. */
    private deliver(panel: Panel, message: unknown): void {
        if (panel.port !== undefined) {
            panel.port.postMessage(message);
            return;
        }
        const chars = JSON.stringify(message).length;
        panel.queue.push({ message, chars });
        panel.queuedChars += chars;
        // Newest kept, within both bounds: a page can post up to the
        // per-message cap each time, and the tab may never connect.
        while (panel.queue.length > MAX_QUEUED || panel.queuedChars > MAX_QUEUED_CHARS) {
            const dropped = panel.queue.shift();
            if (dropped === undefined) break;
            panel.queuedChars -= dropped.chars;
        }
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
        panel.queuedChars = 0;
        if (tellPage) this.toPage(panel, { type: WEBVIEW_TYPE, op: 'closed', panel: panel.id });
    }

    private toPage(panel: Panel, message: PanelToPage): void {
        this.toSource(panel.source, message);
    }

    private toSource(source: number, message: PanelToPage): void {
        try {
            this.sources.get(source)?.postMessage({ webview: message });
        } catch {
            // The page's content script went away; sourceGone follows.
        }
    }
}
