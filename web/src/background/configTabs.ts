// The config page's tabs: one per workspace, opened for a page on that
// workspace and recognised afterwards by the tab id this side created --
// which is also how the page's requests are tied to a workspace: never by
// anything the page says. Opening one comes out of the source tab's open
// budget, shared with the panels.
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

    constructor(
        private readonly tabs: ConfigTabsApi,
        private readonly budget: OpenBudget,
    ) {}

    /** Shows `workspace`'s config page, opening it beside `source` if there is none. */
    open(source: number, workspace: string, windowId?: number): void {
        const existing = this.byWorkspace.get(workspace);
        if (existing !== undefined) {
            void this.tabs.activate(existing).catch(ignore);
            return;
        }
        if (this.opening.has(workspace) || !this.budget.take(source)) return;
        this.opening.add(workspace);
        void this.tabs
            .create({ url: this.tabs.url, openerTabId: source, ...(windowId !== undefined && { windowId }) })
            .then((tab) => {
                if (tab.id === undefined) return;
                this.byWorkspace.set(workspace, tab.id);
                this.byTab.set(tab.id, workspace);
            }, ignore)
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
    }

    get size(): number {
        return this.byTab.size;
    }
}
