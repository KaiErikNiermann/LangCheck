// The config page's tabs: one per workspace, opened for a page on that
// workspace and recognised afterwards by the tab id this side created --
// which is also how the page's requests are tied to a workspace: never by
// anything the page says. Opening one comes out of the source tab's open
// budget, shared with the panels.
import type { NotOpenedReason } from '../messaging/webview';
import type { OpenBudget } from './openBudget';

/** The tab calls the config tabs make (browser.tabs, or a fake). */
export interface ConfigTabsApi {
    create(options: { url: string; openerTabId: number; windowId?: number }): Promise<{ id?: number }>;
    activate(tabId: number): Promise<void>;
    /** The config page's URL. */
    readonly url: string;
}

const ignore = (): void => {};

export class ConfigTabs {
    private readonly byWorkspace = new Map<string, number>();
    private readonly byTab = new Map<number, string>();
    /** Workspaces whose tab is being created. */
    private readonly opening = new Set<string>();

    /**
     * `changed` gets the tabs whenever they change, to keep them across a
     * restart of the background (an MV3 service worker is stopped when idle,
     * and the config page outlives it); `restore` puts them back.
     */
    constructor(
        private readonly tabs: ConfigTabsApi,
        private readonly budget: OpenBudget,
        private readonly changed: (tabs: readonly (readonly [number, string])[]) => void = () => {},
    ) {}

    /** Puts back tabs kept across a restart (the ones still open: the caller checks). */
    restore(tabs: readonly (readonly [number, string])[]): void {
        for (const [tab, workspace] of tabs) {
            this.byTab.set(tab, workspace);
            this.byWorkspace.set(workspace, tab);
        }
    }

    private save(): void {
        this.changed([...this.byTab]);
    }

    /** Shows `workspace`'s config page, opening it beside `source` if there is none. */
    open(source: number, workspace: string, windowId?: number, notOpened: (reason: NotOpenedReason) => void = () => {}): void {
        const existing = this.byWorkspace.get(workspace);
        if (existing !== undefined) {
            void this.tabs.activate(existing).catch(ignore);
            return;
        }
        if (this.opening.has(workspace)) return;
        if (!this.budget.take(source)) {
            notOpened('busy');
            return;
        }
        this.opening.add(workspace);
        void this.tabs
            .create({ url: this.tabs.url, openerTabId: source, ...(windowId !== undefined && { windowId }) })
            .then((tab) => {
                if (tab.id === undefined) {
                    notOpened('failed');
                    return;
                }
                this.byWorkspace.set(workspace, tab.id);
                this.byTab.set(tab.id, workspace);
                this.save();
            }, (error: unknown) => {
                console.warn('[language-check] the config page did not open:', error);
                notOpened('failed');
            })
            .finally(() => {
                this.opening.delete(workspace);
            });
    }

    /** The workspace of the config page in `tab`, if this side opened one there. */
    workspaceOf(tab: number | undefined): string | undefined {
        return tab === undefined ? undefined : this.byTab.get(tab);
    }

    /** A tab was closed (any tab: only config tabs matter here). */
    tabRemoved(tab: number): void {
        const workspace = this.byTab.get(tab);
        if (workspace === undefined) return;
        this.byTab.delete(tab);
        this.byWorkspace.delete(workspace);
        this.save();
    }

    get size(): number {
        return this.byTab.size;
    }
}
