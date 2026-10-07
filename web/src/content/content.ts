// The isolated-world content script: the boundary between the untrusted page
// world and the extension. It answers the page's announcement with a private
// MessagePort, parses every request strictly, and relays to the background,
// which files it under the workspace the browser says this tab is on. A
// page that spoofs our page script gets exactly what our page script gets:
// checks of text it already has, in its own project's workspace.
import browser, { type Runtime } from 'webextension-polyfill';
import {
    COMMAND_TYPE,
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
import { WEBVIEW_TYPE, parsePageToPanel, parsePanelToPage, type PageToPanel, type PanelToPage } from '../messaging/webview';
import { startPalette } from '../palette/overlay';
import type { SiteWorkspace } from '../sites/site';

/** Ports one tab may hold; a page re-announcing in a loop gets no more. */
const MAX_PORTS_PER_TAB = 4;

export function startContent(site: SiteWorkspace): void {
    // Not a project page: nothing to serve (the background would refuse too).
    if (site.projectFromPath(location.pathname) === undefined) return;
    /** The page script's most recent port: where palette commands and panel messages go. */
    let pagePort: MessagePort | undefined;
    /** Panels this tab opened, so a background restart can report them closed. */
    const panels = new Set<string>();
    const background = new BackgroundLink(
        (message) => {
            if (message.op === 'closed') panels.delete(message.panel);
            pagePort?.postMessage(message);
        },
        () => {
            for (const panel of panels) pagePort?.postMessage({ type: WEBVIEW_TYPE, op: 'closed', panel });
            panels.clear();
        },
    );
    startPalette((id) => {
        pagePort?.postMessage({ type: COMMAND_TYPE, command: id });
    });
    let ports = 0;

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data: unknown = event.data;
        if (typeof data !== 'object' || data === null) return;
        const { type, version } = data as { type?: unknown; version?: unknown };
        if (type !== PAGE_READY_TYPE || version !== PROTOCOL_VERSION || ports >= MAX_PORTS_PER_TAB) return;
        ports++;
        const channel = new MessageChannel();
        servePort(channel.port1, background, panels);
        pagePort = channel.port1;
        window.postMessage({ type: HANDSHAKE_TYPE, version: PROTOCOL_VERSION }, location.origin, [channel.port2]);
    });
}

function servePort(port: MessagePort, background: BackgroundLink, panels: Set<string>): void {
    let inFlight = 0;
    const reply = (response: PageResponse): void => { port.postMessage(response); };
    const fail = (id: number, code: ErrorCode, error: string): void => { reply({ id, ok: false, code, error }); };

    port.addEventListener('message', (event: MessageEvent) => {
        if ((event.data as { type?: unknown } | null)?.type === WEBVIEW_TYPE) {
            const panelMessage = parsePageToPanel(event.data);
            if (panelMessage === undefined) return;
            if (panelMessage.op === 'open') panels.add(panelMessage.panel);
            background.postWebview(panelMessage);
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
class BackgroundLink {
    private port: Runtime.Port | undefined;
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (r: PageResponse) => void; pageId: number }>();

    send(request: PageRequest): Promise<PageResponse> {
        const port = this.connect();
        const id = this.nextId++;
        return new Promise((resolve) => {
            this.pending.set(id, { resolve, pageId: request.id });
            const message: BackgroundRequest = { id, request };
            port.postMessage(message);
        });
    }

    constructor(
        private readonly onWebview: (message: PanelToPage) => void,
        private readonly onDisconnected: () => void,
    ) {}

    postWebview(message: PageToPanel): void {
        this.connect().postMessage({ webview: message });
    }

    private connect(): Runtime.Port {
        if (this.port !== undefined) return this.port;
        const port = browser.runtime.connect({ name: BACKGROUND_PORT_NAME });
        port.onMessage.addListener((message: unknown) => {
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
            this.port = undefined;
            for (const [, entry] of this.pending) {
                entry.resolve({ id: entry.pageId, ok: false, code: 'unavailable', error: 'the extension background restarted' });
            }
            this.pending.clear();
            this.onDisconnected();
        });
        this.port = port;
        return port;
    }
}
