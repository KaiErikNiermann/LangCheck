// The page world's line to the core. The content script hands over a
// MessagePort in answer to our "page ready" announcement; requests then go
// over that port, each with a timeout, and at most MAX_IN_FLIGHT_PER_PAGE at
// once. Load order between the two scripts is not guaranteed, so the
// announcement repeats until a port arrives.
import { isPaletteCommand, type PaletteCommandId } from '../palette/commands';
import {
    COMMAND_TYPE,
    HANDSHAKE_TYPE,
    MAX_IN_FLIGHT_PER_PAGE,
    PAGE_READY_TYPE,
    PROTOCOL_VERSION,
    parsePageResponse,
    type ErrorCode,
    type LanguageId,
    type PageRequest,
    type PageResponse,
    type WireDiagnostic,
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

type RequestBody = PageRequest extends infer R ? (R extends PageRequest ? Omit<R, 'id'> : never) : never;

interface Pending {
    readonly resolve: (response: PageResponse) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

export interface CoreClient {
    check(text: string, languageId: LanguageId): Promise<readonly WireDiagnostic[]>;
    addWord(word: string): Promise<void>;
    ignore(request: Omit<Extract<PageRequest, { op: 'ignore' }>, 'id' | 'op'>): Promise<void>;
    /** Commands chosen in the palette, for the page to run. */
    onCommand(listener: (id: PaletteCommandId) => void): void;
    dispose(): void;
}

export function connectCore(target: Window = window): CoreClient {
    let nextId = 1;
    const pending = new Map<number, Pending>();
    const commandListeners: ((id: PaletteCommandId) => void)[] = [];
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

    void port.then(
        (p) => {
            p.addEventListener('message', (event: MessageEvent) => {
                const command = (event.data as { type?: unknown; command?: unknown } | null) ?? {};
                if (command.type === COMMAND_TYPE) {
                    if (isPaletteCommand(command.command)) for (const listener of commandListeners) listener(command.command);
                    return;
                }
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

    const send = async (body: RequestBody): Promise<PageResponse> => {
        if (disposed) throw new CoreError('failed', 'client disposed');
        if (pending.size >= MAX_IN_FLIGHT_PER_PAGE) throw new CoreError('busy', 'too many requests in flight');
        const p = await port;
        const id = nextId++;
        return new Promise<PageResponse>((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve({ id, ok: false, code: 'timeout', error: `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` });
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, timer });
            p.postMessage({ ...body, id });
        });
    };

    const expectOk = async (body: RequestBody): Promise<PageResponse & { ok: true }> => {
        const response = await send(body);
        if (!response.ok) throw new CoreError(response.code, response.error);
        return response;
    };

    return {
        async check(text, languageId) {
            const response = await expectOk({ op: 'check', text, languageId });
            return response.diagnostics ?? [];
        },
        async addWord(word) {
            await expectOk({ op: 'addWord', word });
        },
        async ignore(request) {
            await expectOk({ op: 'ignore', ...request });
        },
        onCommand(listener) {
            commandListeners.push(listener);
        },
        dispose() {
            disposed = true;
            commandListeners.length = 0;
            for (const [id, entry] of pending) {
                clearTimeout(entry.timer);
                entry.resolve({ id, ok: false, code: 'failed', error: 'client disposed' });
            }
            pending.clear();
            void port.then((p) => { p.close(); }, () => {});
        },
    };
}
