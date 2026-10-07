// The page world's line to the core. The content script hands over a
// MessagePort in answer to our "page ready" announcement; requests then go
// over that port, each with a timeout, and at most MAX_IN_FLIGHT_PER_PAGE at
// once. Load order between the two scripts is not guaranteed, so the
// announcement repeats until a port arrives.
import { isPaletteCommand, type PaletteCommandId } from '../palette/commands';
import { WEBVIEW_TYPE, parsePanelToPage, type PageToPanel, type PanelToPage } from './webview';
import {
    COMMAND_TYPE,
    RELOAD_TYPE,
    HANDSHAKE_TYPE,
    MAX_IN_FLIGHT_PER_PAGE,
    PAGE_READY_TYPE,
    PROTOCOL_VERSION,
    parsePageResponse,
    type CoreRequest,
    type ErrorCode,
    type PageRequest,
    type PageResponse,
} from './protocol';

/** How often the page re-announces itself while waiting for its port. */
const ANNOUNCE_EVERY_MS = 250;
/** After this long without a port, requests fail as `unavailable`. */
const HANDSHAKE_TIMEOUT_MS = 20_000;
/** A check through LanguageTool can take seconds; past this, the answer is not coming. */
export const REQUEST_TIMEOUT_MS = 60_000;

export class CoreError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'CoreError';
    }
}

interface Pending {
    readonly resolve: (response: PageResponse) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

export interface CoreClient {
    /** One request to the core; a failure is a response too (`ok: false`), never a throw. */
    request(core: CoreRequest): Promise<PageResponse>;
    /** Commands chosen in the palette, for the page to run. */
    onCommand(listener: (id: PaletteCommandId) => void): void;
    /** Sends a panel message (no answer is awaited). */
    post(message: PageToPanel): void;
    /** Messages from panels, and their closing. */
    onWebview(listener: (message: PanelToPage) => void): void;
    /** The workspace's config changed: check again. */
    onReload(listener: () => void): void;
    dispose(): void;
}

export function connectCore(target: Window = window): CoreClient {
    let nextId = 1;
    const pending = new Map<number, Pending>();
    const commandListeners: ((id: PaletteCommandId) => void)[] = [];
    const webviewListeners: ((message: PanelToPage) => void)[] = [];
    const reloadListeners: (() => void)[] = [];
    let disposed = false;

    const port = new Promise<MessagePort>((resolve, reject) => {
        const announce = (): void => { target.postMessage({ type: PAGE_READY_TYPE, version: PROTOCOL_VERSION }, target.location.origin); };
        const onMessage = (event: MessageEvent): void => {
            // Only the content script's answer: same window, our tag and
            // version, and a port attached.
            const data: unknown = event.data;
            if (data === null || typeof data !== 'object' || event.source !== target || event.origin !== target.location.origin) return;
            const { type, version } = data as { type?: unknown; version?: unknown };
            const received = event.ports[0];
            if (type !== HANDSHAKE_TYPE || version !== PROTOCOL_VERSION || received === undefined) return;
            cleanup();
            resolve(received);
        };
        const timer = setInterval(announce, ANNOUNCE_EVERY_MS);
        const deadline = setTimeout(() => {
            cleanup();
            reject(new CoreError('unavailable', 'the LangCheck extension did not answer (is it installed and enabled for this site?)'));
        }, HANDSHAKE_TIMEOUT_MS);
        const cleanup = (): void => {
            clearInterval(timer);
            clearTimeout(deadline);
            target.removeEventListener('message', onMessage);
        };
        target.addEventListener('message', onMessage);
        announce();
    });

    /** Handles what the content script sends unasked (commands, reloads, panel messages); `false` for a response. */
    const handleUnasked = (data: unknown): boolean => {
        const message = (data as { type?: unknown; command?: unknown } | null) ?? {};
        switch (message.type) {
            case COMMAND_TYPE:
                if (isPaletteCommand(message.command)) for (const listener of commandListeners) listener(message.command);
                return true;
            case RELOAD_TYPE:
                for (const listener of reloadListeners) listener();
                return true;
            case WEBVIEW_TYPE: {
                const panelMessage = parsePanelToPage(data);
                if (panelMessage !== undefined) for (const listener of webviewListeners) listener(panelMessage);
                return true;
            }
            default:
                return false;
        }
    };

    void port.then(
        (p) => {
            p.addEventListener('message', (event: MessageEvent) => {
                if (handleUnasked(event.data)) return;
                const response = parsePageResponse(event.data);
                if (response === undefined) return;
                const entry = pending.get(response.id);
                if (entry === undefined) return;
                pending.delete(response.id);
                clearTimeout(entry.timer);
                entry.resolve(response);
            });
            p.start();
        },
        () => {},
    );

    const send = async (core: CoreRequest): Promise<PageResponse> => {
        const id = nextId++;
        if (disposed) return { id, ok: false, code: 'failed', error: 'client disposed' };
        if (pending.size >= MAX_IN_FLIGHT_PER_PAGE) return { id, ok: false, code: 'busy', error: 'too many requests in flight' };
        let p: MessagePort;
        try {
            p = await port;
        } catch (error) {
            return { id, ok: false, code: 'unavailable', error: error instanceof Error ? error.message : String(error) };
        }
        return new Promise<PageResponse>((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve({ id, ok: false, code: 'timeout', error: `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` });
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, timer });
            const message: PageRequest = { id, request: core };
            p.postMessage(message);
        });
    };

    return {
        request: send,
        onCommand(listener) {
            commandListeners.push(listener);
        },
        post(message) {
            if (disposed) return;
            void port.then(
                (p) => {
                    p.postMessage(message);
                },
                () => {},
            );
        },
        onWebview(listener) {
            webviewListeners.push(listener);
        },
        onReload(listener) {
            reloadListeners.push(listener);
        },
        dispose() {
            disposed = true;
            commandListeners.length = 0;
            webviewListeners.length = 0;
            reloadListeners.length = 0;
            for (const [id, entry] of pending) {
                clearTimeout(entry.timer);
                entry.resolve({ id, ok: false, code: 'failed', error: 'client disposed' });
            }
            pending.clear();
            void port.then((p) => { p.close(); }, () => {});
        },
    };
}
