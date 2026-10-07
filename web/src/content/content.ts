// The isolated-world content script: the boundary between the untrusted page
// world and the extension. It answers the page's announcement with a private
// MessagePort, parses every request strictly, attaches the workspace key it
// derived from the tab's URL itself, and relays to the background. A page
// that spoofs our page script gets exactly what our page script gets: checks
// of text it already has, in its own project's workspace.
import browser, { type Runtime } from 'webextension-polyfill';
import {
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
import { workspaceKey, type SiteWorkspace } from '../sites/site';

/** Ports one tab may hold; a page re-announcing in a loop gets no more. */
const MAX_PORTS_PER_TAB = 4;

export function startContent(site: SiteWorkspace): void {
    const project = site.projectFromPath(location.pathname);
    if (project === undefined) return;
    const key = workspaceKey(site.id, project);
    const background = new BackgroundLink();
    let ports = 0;

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data: unknown = event.data;
        if (typeof data !== 'object' || data === null) return;
        const { type, version } = data as { type?: unknown; version?: unknown };
        if (type !== PAGE_READY_TYPE || version !== PROTOCOL_VERSION || ports >= MAX_PORTS_PER_TAB) return;
        ports++;
        const channel = new MessageChannel();
        servePort(channel.port1, key, background);
        window.postMessage({ type: HANDSHAKE_TYPE, version: PROTOCOL_VERSION }, location.origin, [channel.port2]);
    });
}

function servePort(port: MessagePort, key: string, background: BackgroundLink): void {
    let inFlight = 0;
    const reply = (response: PageResponse): void => { port.postMessage(response); };
    const fail = (id: number, code: ErrorCode, error: string): void => { reply({ id, ok: false, code, error }); };

    port.addEventListener('message', (event: MessageEvent) => {
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
            .send(key, request)
            .then(reply, (error: unknown) => { fail(request.id, 'unavailable', String(error)); })
            .finally(() => inFlight--);
    });
    port.start();
}

/** One runtime port to the background, reopened on demand after the background restarts. */
class BackgroundLink {
    private port: Runtime.Port | undefined;
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (r: PageResponse) => void; pageId: number }>();

    send(key: string, request: PageRequest): Promise<PageResponse> {
        const port = this.connect();
        const id = this.nextId++;
        return new Promise((resolve) => {
            this.pending.set(id, { resolve, pageId: request.id });
            const message: BackgroundRequest = { id, key, request };
            port.postMessage(message);
        });
    }

    private connect(): Runtime.Port {
        if (this.port !== undefined) return this.port;
        const port = browser.runtime.connect({ name: BACKGROUND_PORT_NAME });
        port.onMessage.addListener((message: unknown) => {
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
        });
        this.port = port;
        return port;
    }
}
