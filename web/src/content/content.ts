// The isolated-world content script: the boundary between the untrusted page
// world and the extension. It answers the page's announcement with a private
// MessagePort, parses every request strictly, and relays to the background,
// which files it under the workspace the browser says this tab is on. A
// page that spoofs our page script gets exactly what our page script gets:
// checks of text it already has, in its own project's workspace.
import browser, { type Runtime } from 'webextension-polyfill';
import {
    BYE_TYPE,
    COMMAND_TYPE,
    RELOAD_TYPE,
    HANDSHAKE_TYPE,
    MAX_IN_FLIGHT_PER_PAGE,
    PAGE_READY_TYPE,
    PROTOCOL_VERSION,
    parsePageRequest,
    type ErrorCode,
    type PageRequest,
    type PageResponse,
} from '../messaging/protocol';
import { BACKGROUND_PORT_NAME, type BackgroundRequest, type BackgroundResponse } from '../messaging/background';
import { WEBVIEW_TYPE, isPanelId, parsePageToPanel, parsePanelToPage, type PageToPanel, type PanelToPage } from '../messaging/webview';
import { startPalette } from '../palette/overlay';
import type { SiteWorkspace } from '../sites/site';

/** Ports one tab may hold; a page re-announcing in a loop gets no more. */
const MAX_PORTS_PER_TAB = 4;

export function startContent(site: SiteWorkspace): void {
    // Served whatever the URL: single-page apps (Notion) move into a
    // workspace's page, and between workspaces, without a load. The link to
    // the background follows (BackgroundLink), and the page script waits for
    // a workspace before it asks anything.
    const workspaceNow = (): string | undefined => site.projectFromPath(location.pathname);
    /**
     * The page's ports, by number. Anything in the page world can announce
     * itself and get one (the site's scripts, other extensions'), so none is
     * trusted over another: each has its own panel ids (scoped below), and
     * palette commands go to all of them.
     */
    const pagePorts = new Map<number, MessagePort>();
    /** Panels this tab opened (scoped ids), so a background restart can report them closed. */
    const panels = new Set<string>();
    const toOwner = (message: PanelToPage): void => {
        const owner = unscopePanel(message.panel);
        if (owner === undefined) return;
        pagePorts.get(owner.port)?.postMessage({ ...message, panel: owner.panel });
    };
    const background = new BackgroundLink(
        (message) => {
            if (message.op === 'closed') panels.delete(message.panel);
            toOwner(message);
        },
        () => {
            for (const panel of panels) toOwner({ type: WEBVIEW_TYPE, op: 'closed', panel });
            panels.clear();
        },
        () => browser.runtime.connect({ name: BACKGROUND_PORT_NAME }),
        workspaceNow,
        () => {
            for (const port of pagePorts.values()) port.postMessage({ type: RELOAD_TYPE });
        },
    );
    startPalette((id) => {
        for (const port of pagePorts.values()) port.postMessage({ type: COMMAND_TYPE, command: id });
    });
    let ports = 0;

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data: unknown = event.data;
        if (typeof data !== 'object' || data === null) return;
        const { type, version } = data as { type?: unknown; version?: unknown };
        // Live ports, not all ever made: a page script restarts (a move to
        // another workspace, a page left and come back to), saying bye.
        if (type !== PAGE_READY_TYPE || version !== PROTOCOL_VERSION || pagePorts.size >= MAX_PORTS_PER_TAB) return;
        ports++;
        const index = ports;
        const channel = new MessageChannel();
        servePort(channel.port1, index, background, panels, () => {
            pagePorts.delete(index);
            channel.port1.close();
        });
        pagePorts.set(index, channel.port1);
        window.postMessage({ type: HANDSHAKE_TYPE, version: PROTOCOL_VERSION }, location.origin, [channel.port2]);
    });
}

/** A page port's panel id as the background knows it: `<port number>-<id>`, so one port cannot address another's panels. */
function scopePanel(port: number, panel: string): string | undefined {
    const scoped = `${String(port)}-${panel}`;
    return isPanelId(scoped) ? scoped : undefined;
}

function unscopePanel(scoped: string): { readonly port: number; readonly panel: string } | undefined {
    const match = /^(\d{1,9})-(.+)$/u.exec(scoped);
    return match === null ? undefined : { port: Number(match[1]), panel: match[2] ?? '' };
}

/** A page port's panel message, its panel id scoped to the port, to the background. */
function relayPanelMessage(data: unknown, index: number, background: BackgroundLink, panels: Set<string>): void {
    const parsed = parsePageToPanel(data);
    if (parsed === undefined) return;
    let panelMessage: PageToPanel = parsed;
    if ('panel' in parsed) {
        const scoped = scopePanel(index, parsed.panel);
        if (scoped === undefined) return;
        panelMessage = { ...parsed, panel: scoped };
    }
    if (panelMessage.op === 'open') panels.add(panelMessage.panel);
    background.postWebview(panelMessage);
}

function servePort(port: MessagePort, index: number, background: BackgroundLink, panels: Set<string>, bye: () => void): void {
    let inFlight = 0;
    const reply = (response: PageResponse): void => { port.postMessage(response); };
    const fail = (id: number, code: ErrorCode, error: string): void => { reply({ id, ok: false, code, error }); };

    port.addEventListener('message', (event: MessageEvent) => {
        const type = (event.data as { type?: unknown } | null)?.type;
        if (type === BYE_TYPE) {
            bye();
            return;
        }
        if (type === WEBVIEW_TYPE) {
            relayPanelMessage(event.data, index, background, panels);
            return;
        }
        const request = parsePageRequest(event.data);
        if (request === undefined) {
            const id = (event.data as { id?: unknown } | null)?.id;
            if (Number.isSafeInteger(id) && (id as number) > 0) fail(id as number, 'refused', 'malformed request');
            return;
        }
        if (inFlight >= MAX_IN_FLIGHT_PER_PAGE) {
            fail(request.id, 'busy', 'too many requests in flight');
            return;
        }
        inFlight++;
        void background
            .send(request)
            .then(reply, () => {
                fail(request.id, 'unavailable', 'the extension background is not reachable');
            })
            .finally(() => inFlight--);
    });
    port.start();
}

/** One runtime port to the background, reopened on demand after the background restarts. */
export class BackgroundLink {
    private port: Runtime.Port | undefined;
    /** The workspace the URL named when `port` was opened: the one the background serves it for. */
    private portWorkspace: string | undefined;
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (r: PageResponse) => void; pageId: number }>();

    /**
     * Rejects, at once, when the background cannot be reached: connecting
     * throws once the extension has been updated or reloaded under an open
     * tab ("Extension context invalidated"), and posting throws on a port
     * that has just gone. The page port answers a rejection as unavailable.
     */
    send(request: PageRequest): Promise<PageResponse> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            try {
                const port = this.connect();
                this.pending.set(id, { resolve, pageId: request.id });
                const message: BackgroundRequest = { id, request };
                port.postMessage(message);
            } catch (error) {
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    constructor(
        private readonly onWebview: (message: PanelToPage) => void,
        private readonly onDisconnected: () => void,
        private readonly connectRuntime: () => Runtime.Port,
        /** The workspace the page's URL names now. */
        private readonly workspaceNow: () => string | undefined,
        /** The background says the workspace's config changed. */
        private readonly onReload: () => void = () => {},
    ) {}

    /** Dropped when the background cannot be reached (see send). */
    postWebview(message: PageToPanel): void {
        try {
            this.connect().postMessage({ webview: message });
        } catch {
            // Nothing to post to; the page's panels are told closed on disconnect.
        }
    }

    private connect(): Runtime.Port {
        // The background takes the workspace from the URL at connect time:
        // after a move to another, a new port, or the old workspace's
        // dictionary and connection would serve the new one.
        const workspace = this.workspaceNow();
        if (this.port !== undefined && workspace !== this.portWorkspace) this.reset('the page moved to another workspace');
        if (this.port !== undefined) return this.port;
        const port = this.connectRuntime();
        this.portWorkspace = workspace;
        port.onMessage.addListener((message: unknown) => {
            if ((message as { reload?: unknown } | null)?.reload === true) {
                this.onReload();
                return;
            }
            const panelMessage = parsePanelToPage((message as { webview?: unknown } | null)?.webview);
            if (panelMessage !== undefined) {
                this.onWebview(panelMessage);
                return;
            }
            const { id, response } = (message ?? {}) as Partial<BackgroundResponse>;
            if (typeof id !== 'number' || response === undefined) return;
            const entry = this.pending.get(id);
            if (entry === undefined) return;
            this.pending.delete(id);
            // The page knows the request by its own id, not ours.
            entry.resolve({ ...response, id: entry.pageId });
        });
        port.onDisconnect.addListener(() => {
            if (this.port === port) this.dropPort('the extension background restarted');
        });
        this.port = port;
        return port;
    }

    /** Lets go of the port (a disconnect of one's own fires no event), failing what waited on it. */
    private reset(reason: string): void {
        const port = this.port;
        this.dropPort(reason);
        port?.disconnect();
    }

    private dropPort(reason: string): void {
        this.port = undefined;
        for (const [, entry] of this.pending) entry.resolve({ id: entry.pageId, ok: false, code: 'unavailable', error: reason });
        this.pending.clear();
        this.onDisconnected();
    }
}
