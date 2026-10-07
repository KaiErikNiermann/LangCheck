// The background's side of the native host: one connection per workspace
// key, each a `connectNative` port to its own host and server. Requests are
// protobuf (the same bindings the VS Code client uses), base64 inside the
// host's JSON frames; responses may arrive in several frames (`more: true`)
// and are joined before decoding.
//
// Failure handling is the point of this file:
// - every request has a timeout, and at most MAX_PENDING wait per connection;
// - a disconnect fails everything pending at once, with the host's reason;
// - reconnecting backs off exponentially while the host keeps failing, so a
//   missing or crashing host is not respawned on every keystroke;
// - idle connections close, and at most MAX_CONNECTIONS stay open.
import { languagecheck } from '../../../extension/src/proto/checker';
import type { ErrorCode, PageRequest, PageResponse, WireDiagnostic } from '../messaging/protocol';
import { base64ToBytes, bytesToBase64 } from './base64';

/** The name the host manifest registers (`HOST_NAME` in the core). */
export const HOST_NAME = 'language_check';

export const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PENDING = 32;
/** A response this large (base64 characters, all frames) is not a real one. */
const MAX_RESPONSE_CHARS = 64 * 1024 * 1024;
const BACKOFF_FIRST_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
export const IDLE_CLOSE_MS = 10 * 60_000;
export const MAX_CONNECTIONS = 4;

/** The part of `runtime.Port` this file uses, so tests can supply a fake host. */
export interface NativePort {
    postMessage(message: unknown): void;
    disconnect(): void;
    readonly onMessage: { addListener(listener: (message: unknown) => void): void };
    readonly onDisconnect: { addListener(listener: (port: NativePort) => void): void };
    readonly error?: { readonly message: string } | null;
}

export type ConnectNative = (host: string) => NativePort;

export interface Clock {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

interface Pending {
    readonly resolve: (response: languagecheck.Response.$Properties | CoreFailure) => void;
    readonly timer: unknown;
}

interface CoreFailure {
    readonly failure: ErrorCode;
    readonly message: string;
}

const isFailure = (r: languagecheck.Response.$Properties | CoreFailure): r is CoreFailure => 'failure' in r;

/** One host process, for one workspace. */
export class CoreConnection {
    private port: NativePort | undefined;
    private initialized: Promise<CoreFailure | undefined> | undefined;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private frames: string[] = [];
    private frameChars = 0;
    /** Consecutive connections that ended before answering anything. */
    private failures = 0;
    private retryAt = 0;
    private lastError = '';
    private answeredSinceConnect = false;
    lastUsed: number;

    constructor(
        readonly key: string,
        private readonly connectNative: ConnectNative,
        private readonly clock: Clock = realClock,
    ) {
        this.lastUsed = clock.now();
    }

    async request(request: PageRequest): Promise<PageResponse> {
        this.lastUsed = this.clock.now();
        const unavailable = this.ensureConnected();
        if (unavailable !== undefined) return failed(request.id, unavailable);
        const initFailure = await this.initialized;
        if (initFailure !== undefined) return failed(request.id, initFailure);
        const response = await this.call(toProto(request));
        return isFailure(response) ? failed(request.id, response) : fromProto(request.id, response);
    }

    close(): void {
        const port = this.port;
        if (port === undefined) return;
        this.onDisconnected('closed');
        port.disconnect();
    }

    /** Starts the host if there is none; `CoreFailure` while backing off after failures. */
    private ensureConnected(): CoreFailure | undefined {
        if (this.port !== undefined) return undefined;
        if (this.clock.now() < this.retryAt) {
            return { failure: 'unavailable', message: this.lastError };
        }
        let port: NativePort;
        try {
            port = this.connectNative(HOST_NAME);
        } catch (error) {
            this.recordFailure(`cannot start the native host: ${String(error)}`);
            return { failure: 'unavailable', message: this.lastError };
        }
        this.port = port;
        this.answeredSinceConnect = false;
        port.onMessage.addListener((message) => { this.onFrame(port, message); });
        port.onDisconnect.addListener((p) => {
            if (this.port === port) this.onDisconnected(p.error?.message ?? port.error?.message ?? 'the native host exited');
        });
        this.initialized = this.call({ initialize: { workspaceRoot: this.key } }).then((response) => {
            if (isFailure(response)) return response;
            return response.error ? { failure: 'failed', message: response.error.message ?? 'initialize failed' } : undefined;
        });
        return undefined;
    }

    private call(payload: languagecheck.Request.$Properties): Promise<languagecheck.Response.$Properties | CoreFailure> {
        const port = this.port;
        if (port === undefined) return Promise.resolve({ failure: 'unavailable', message: this.lastError || 'not connected' });
        if (this.pending.size >= MAX_PENDING) return Promise.resolve({ failure: 'busy', message: 'too many requests waiting on the core' });
        const id = this.nextId++;
        const bytes = languagecheck.Request.encode(languagecheck.Request.create({ ...payload, id })).finish();
        return new Promise((resolve) => {
            const timer = this.clock.setTimeout(() => {
                this.pending.delete(id);
                resolve({ failure: 'timeout', message: `the core did not answer within ${REQUEST_TIMEOUT_MS / 1000}s` });
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, timer });
            try {
                port.postMessage({ frame: bytesToBase64(bytes) });
            } catch (error) {
                this.pending.delete(id);
                this.clock.clearTimeout(timer);
                resolve({ failure: 'unavailable', message: String(error) });
            }
        });
    }

    private onFrame(port: NativePort, message: unknown): void {
        if (this.port !== port) return;
        const { frame, more } = (message ?? {}) as { frame?: unknown; more?: unknown };
        if (typeof frame !== 'string' || typeof more !== 'boolean') {
            this.drop(port, 'the native host sent a malformed frame');
            return;
        }
        this.frameChars += frame.length;
        if (this.frameChars > MAX_RESPONSE_CHARS) {
            this.drop(port, 'the native host sent an oversized response');
            return;
        }
        this.frames.push(frame);
        if (more) return;
        const joined = this.frames.join('');
        this.frames = [];
        this.frameChars = 0;
        let response: languagecheck.Response;
        try {
            response = languagecheck.Response.decode(base64ToBytes(joined));
        } catch {
            this.drop(port, 'the native host sent an undecodable response');
            return;
        }
        const id = Number(response.id);
        const entry = this.pending.get(id);
        if (entry === undefined) return;
        this.pending.delete(id);
        this.clock.clearTimeout(entry.timer);
        this.answeredSinceConnect = true;
        this.failures = 0;
        entry.resolve(response);
    }

    /** A stream that broke its framing cannot be trusted for the next response either. */
    private drop(port: NativePort, reason: string): void {
        this.onDisconnected(reason);
        port.disconnect();
    }

    private onDisconnected(reason: string): void {
        this.port = undefined;
        this.initialized = undefined;
        this.frames = [];
        this.frameChars = 0;
        if (reason !== 'closed' && !this.answeredSinceConnect) this.recordFailure(reason);
        for (const [, entry] of this.pending) {
            this.clock.clearTimeout(entry.timer);
            entry.resolve({ failure: 'unavailable', message: reason });
        }
        this.pending.clear();
    }

    private recordFailure(reason: string): void {
        this.failures++;
        this.lastError = reason;
        this.retryAt = this.clock.now() + Math.min(BACKOFF_FIRST_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
    }
}

/** All workspaces' connections, closed when idle and capped in number. */
export class CoreManager {
    private readonly connections = new Map<string, CoreConnection>();

    constructor(
        private readonly connectNative: ConnectNative,
        private readonly clock: Clock = realClock,
    ) {}

    request(key: string, request: PageRequest): Promise<PageResponse> {
        let connection = this.connections.get(key);
        if (connection === undefined) {
            connection = new CoreConnection(key, this.connectNative, this.clock);
            this.connections.set(key, connection);
            this.evict();
        }
        return connection.request(request);
    }

    /** Closes connections idle for IDLE_CLOSE_MS; called on a timer by the background. */
    sweep(): void {
        const cutoff = this.clock.now() - IDLE_CLOSE_MS;
        for (const [key, connection] of this.connections) {
            if (connection.lastUsed >= cutoff) continue;
            connection.close();
            this.connections.delete(key);
        }
    }

    get size(): number {
        return this.connections.size;
    }

    private evict(): void {
        while (this.connections.size > MAX_CONNECTIONS) {
            let oldest: CoreConnection | undefined;
            for (const connection of this.connections.values()) {
                if (oldest === undefined || connection.lastUsed < oldest.lastUsed) oldest = connection;
            }
            if (oldest === undefined) return;
            oldest.close();
            this.connections.delete(oldest.key);
        }
    }
}

const failed = (id: number, f: CoreFailure): PageResponse => ({ id, ok: false, code: f.failure, error: f.message });

function toProto(request: PageRequest): languagecheck.Request.$Properties {
    switch (request.op) {
        case 'check': {
            return { checkProse: { text: request.text, languageId: request.languageId } };
        }
        case 'addWord': {
            return { addDictionaryWord: { word: request.word } };
        }
        case 'ignore': {
            return {
                ignore: {
                    message: request.message,
                    context: request.context,
                    text: request.text,
                    startByte: request.startByte,
                    endByte: request.endByte,
                },
            };
        }
    }
}

function fromProto(id: number, response: languagecheck.Response.$Properties): PageResponse {
    if (response.error) return { id, ok: false, code: 'failed', error: response.error.message ?? 'the core reported an error' };
    if (response.checkProse) {
        return { id, ok: true, diagnostics: (response.checkProse.diagnostics ?? []).map((d) => toWire(d)) };
    }
    return response.ok ? { id, ok: true } : { id, ok: false, code: 'failed', error: 'unexpected response from the core' };
}

function toWire(d: languagecheck.Diagnostic.$Properties): WireDiagnostic {
    return {
        startByte: d.startByte ?? 0,
        endByte: d.endByte ?? 0,
        message: d.message ?? '',
        severity: d.severity ?? 0,
        ruleId: d.ruleId ?? '',
        unifiedId: d.unifiedId ?? '',
        suggestions: d.suggestions ?? [],
        confidence: d.confidence ?? 0,
    };
}
