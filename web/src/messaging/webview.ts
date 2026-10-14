// Messages that carry a webview panel (SpeedFix, Inspector) between the page
// world, where the client's panel code runs, and the extension tab that shows
// the panel's app:
//
//   page ──port──▶ content script ──runtime port──▶ background ──runtime port──▶ panel tab
//
// The page world is untrusted, so the content script parses what it sends
// (and the background parses it again): a known panel kind, a short id the
// page chose, a bounded message. Panels are named by the background as
// `<tab id>:<page's id>`, so one tab cannot address another's.

/** The panels the web can show: the client's two webview apps. */
export const VIEW_TYPES = ['speedFix', 'inspector'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const WEBVIEW_TYPE = 'webview';
/** The runtime port a panel tab connects on. */
export const PANEL_PORT_NAME = 'language-check-panel';

/** Largest message to or from a panel, as JSON (an Inspector update on a long document is the big one). */
export const MAX_PANEL_MESSAGE_CHARS = 8 * 1024 * 1024;

const PANEL_ID = /^[a-z0-9-]{1,40}$/u;

export type PageToPanel =
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'open'; readonly panel: string; readonly viewType: ViewType }
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'post'; readonly panel: string; readonly message: unknown }
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'reveal' | 'close'; readonly panel: string }
    /** Bring the page's own tab to the front (go-to-location from a panel). */
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'focusEditor' }
    /** Show the config page of the page's workspace (which the background takes from the tab, not from here). */
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'openConfig' };

/** Why a tab the page asked for did not open: too many opened from the page this minute, or the browser would not open one. */
export const NOT_OPENED_REASONS = ['busy', 'failed'] as const;
export type NotOpenedReason = (typeof NOT_OPENED_REASONS)[number];
const isNotOpenedReason = (v: unknown): v is NotOpenedReason => (NOT_OPENED_REASONS as readonly unknown[]).includes(v);

export type PanelToPage =
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'message'; readonly panel: string; readonly message: unknown }
    /** `reason`: the panel's tab never opened, and why (none when the page closed it, or the user did). */
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'closed'; readonly panel: string; readonly reason?: NotOpenedReason }
    /** The config page the page asked for did not open. */
    | { readonly type: typeof WEBVIEW_TYPE; readonly op: 'configNotOpened'; readonly reason: NotOpenedReason };

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isPanelId = (v: unknown): v is string => typeof v === 'string' && PANEL_ID.test(v);
const isViewType = (v: unknown): v is ViewType => (VIEW_TYPES as readonly unknown[]).includes(v);

/** Whether `message` is plain data within the size cap (what JSON can carry, as the runtime ports do). */
export function isBoundedMessage(message: unknown): boolean {
    try {
        const json = JSON.stringify(message) as string | undefined;
        return json !== undefined && json.length <= MAX_PANEL_MESSAGE_CHARS;
    } catch {
        return false;
    }
}

/** Parses a panel message from the page world, or `undefined` when it is not one. */
export function parsePageToPanel(value: unknown): PageToPanel | undefined {
    if (!isBag(value) || value.type !== WEBVIEW_TYPE) return undefined;
    switch (value.op) {
        case 'open':
            // No title: the panel page has its own (VS Code's tab title, fixed per view type).
            return isPanelId(value.panel) && isViewType(value.viewType) ? { type: WEBVIEW_TYPE, op: 'open', panel: value.panel, viewType: value.viewType } : undefined;
        case 'post':
            return isPanelId(value.panel) && isBoundedMessage(value.message) ? { type: WEBVIEW_TYPE, op: 'post', panel: value.panel, message: value.message } : undefined;
        case 'reveal':
        case 'close':
            return isPanelId(value.panel) ? { type: WEBVIEW_TYPE, op: value.op, panel: value.panel } : undefined;
        case 'focusEditor':
        case 'openConfig':
            return { type: WEBVIEW_TYPE, op: value.op };
        default:
            return undefined;
    }
}

/** Parses a panel message arriving in the page (from the trusted side; checked for shape only). */
export function parsePanelToPage(value: unknown): PanelToPage | undefined {
    if (!isBag(value) || value.type !== WEBVIEW_TYPE) return undefined;
    if (value.op === 'configNotOpened') return isNotOpenedReason(value.reason) ? { type: WEBVIEW_TYPE, op: 'configNotOpened', reason: value.reason } : undefined;
    if (!isPanelId(value.panel)) return undefined;
    if (value.op === 'closed') {
        return isNotOpenedReason(value.reason) ? { type: WEBVIEW_TYPE, op: 'closed', panel: value.panel, reason: value.reason } : { type: WEBVIEW_TYPE, op: 'closed', panel: value.panel };
    }
    return value.op === 'message' ? { type: WEBVIEW_TYPE, op: 'message', panel: value.panel, message: value.message } : undefined;
}
