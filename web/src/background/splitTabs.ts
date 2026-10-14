// Opens a panel tab as its page's split-view partner where the browser can
// make one, as VS Code opens SpeedFix and the Inspector beside the editor.
//
// The API is the WECG's (w3c/webextensions PR 1019): `tabs.create` with
// `splitWithTabId`, and `tabs.createSplit` / `tabs.unsplit` beside it. A
// browser that cannot split may refuse, or may hand back a tab that is not
// split; either way the panel still opens, as a plain tab.
//
// - Chromium has it from Chrome 155. There is no way to ask whether
//   `tabs.create` reads `splitWithTabId`, so `tabs.createSplit`, which came
//   with it, is what says so.
// - Gecko can read splits (Firefox 149) but not make them yet (bug 2016928).
//   Its path is here and off: GECKO_SPLIT_VERIFIED turns it on once a
//   Firefox that makes splits has been tried with an extension page.

/**
 * Whether Firefox's split views have been seen to take an extension tab.
 * Off until then: a Firefox that grows `tabs.createSplit` keeps opening
 * plain tabs until someone has checked it (test/e2e/realPathSplit.spec.ts
 * is the check on Chromium).
 */
export const GECKO_SPLIT_VERIFIED = false;

/** `tabs.SPLIT_VIEW_ID_NONE`: what `Tab.splitViewId` holds for a tab in no split. */
export const SPLIT_VIEW_ID_NONE = -1;

export type Engine = 'chromium' | 'gecko';

export interface CreateOptions {
    readonly url: string;
    readonly openerTabId: number;
    readonly windowId?: number;
}

export interface CreatedTab {
    readonly id?: number;
    readonly windowId?: number;
    readonly splitViewId?: number;
}

/** The tab calls a split needs (browser.tabs, or a fake). */
export interface SplitTabsApi {
    readonly engine: Engine;
    /** Whether `tabs.createSplit` exists: the browser knows split views. */
    readonly knowsSplits: boolean;
    create(options: CreateOptions & { readonly splitWithTabId?: number }): Promise<CreatedTab>;
}

/** Whether a panel tab is opened as a split here at all. */
export function splitsHere(api: Pick<SplitTabsApi, 'engine' | 'knowsSplits'>): boolean {
    return api.knowsSplits && (api.engine === 'chromium' || GECKO_SPLIT_VERIFIED);
}

/**
 * Opens `options.url` in a new tab, as the split partner of the opener where
 * this browser makes splits, else as a plain tab beside it. `split` says
 * which it became. A refused split (the opener pinned or already split, or
 * an extension page not allowed in one) opens the plain tab instead.
 */
export async function createBeside(api: SplitTabsApi, options: CreateOptions): Promise<{ tab: CreatedTab; split: boolean }> {
    if (!splitsHere(api)) return { tab: await api.create(options), split: false };
    try {
        const tab = await api.create({ ...options, splitWithTabId: options.openerTabId });
        return { tab, split: tab.splitViewId !== undefined && tab.splitViewId !== SPLIT_VIEW_ID_NONE };
    } catch (error) {
        console.info('[language-check] the panel could not open as a split view; opening it as a tab:', error);
        return { tab: await api.create(options), split: false };
    }
}

/** The raw `tabs` namespace, where a split-capable browser has `createSplit`. */
interface RawTabs {
    createSplit?: unknown;
    create(options: object): Promise<CreatedTab>;
}

/**
 * The browser's own tabs API for createBeside. Raw rather than through
 * webextension-polyfill, which knows no split fields: `chrome.tabs`, which
 * Firefox has too, promise-returning in MV3 on both.
 */
export function browserSplitTabs(runtime: { getBrowserInfo?: unknown }): SplitTabsApi {
    const tabs = (globalThis as { chrome?: { tabs?: RawTabs } }).chrome?.tabs;
    return {
        // Only Firefox has runtime.getBrowserInfo.
        engine: typeof runtime.getBrowserInfo === 'function' ? 'gecko' : 'chromium',
        knowsSplits: typeof tabs?.createSplit === 'function',
        create: (options) => {
            if (tabs === undefined) return Promise.reject(new Error('no tabs API'));
            return tabs.create({ ...options });
        },
    };
}
