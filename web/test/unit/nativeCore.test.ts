// CoreConnection against a fake native host that speaks the real wire format
// (base64 protobuf in JSON frames), with a fake clock for timeouts and backoff.
import { describe, expect, test } from 'vitest';
import { languagecheck } from '../../../extension/src/proto/checker';
import { base64ToBytes, bytesToBase64 } from '../../src/background/base64';
import { CoreConnection, CoreManager, IDLE_CLOSE_MS, MAX_CONNECTIONS, REQUEST_TIMEOUT_MS, type Clock, type NativePort } from '../../src/background/nativeCore';

class FakeClock implements Clock {
    time = 0;
    private timers: { at: number; callback: () => void; id: number }[] = [];
    private nextId = 1;
    now = (): number => this.time;
    setTimeout = (callback: () => void, ms: number): unknown => {
        const id = this.nextId++;
        this.timers.push({ at: this.time + ms, callback, id });
        return id;
    };
    clearTimeout = (handle: unknown): void => {
        this.timers = this.timers.filter((t) => t.id !== handle);
    };
    advance(ms: number): void {
        this.time += ms;
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) t.callback();
    }
}

type Behaviour = 'answer' | 'silent' | 'crash-on-start' | 'split';

/** A host that answers like language-check-native-host, or misbehaves on purpose. */
class FakeHost implements NativePort {
    private readonly messageListeners: ((m: unknown) => void)[] = [];
    private readonly disconnectListeners: ((p: NativePort) => void)[] = [];
    error: { message: string } | null = null;
    received: languagecheck.Request[] = [];
    disconnected = false;

    constructor(private readonly behaviour: Behaviour) {
        if (behaviour === 'crash-on-start') {
            queueMicrotask(() => { this.crash('Specified native messaging host not found.'); });
        }
    }

    readonly onMessage = { addListener: (l: (m: unknown) => void) => void this.messageListeners.push(l) };
    readonly onDisconnect = { addListener: (l: (p: NativePort) => void) => void this.disconnectListeners.push(l) };

    postMessage(message: unknown): void {
        const request = languagecheck.Request.decode(base64ToBytes((message as { frame: string }).frame));
        this.received.push(request);
        if (this.behaviour !== 'answer' && this.behaviour !== 'split') return;
        const response = languagecheck.Response.create({ id: request.id });
        if (request.initialize) response.initialize = {};
        else if (request.checkProse) {
            response.checkProse = { diagnostics: [{ startByte: 0, endByte: 3, message: 'Possible spelling mistake', ruleId: 'Spell', suggestions: ['the'], severity: languagecheck.Severity.SEVERITY_WARNING }] };
        } else response.ok = {};
        const frame = bytesToBase64(languagecheck.Response.encode(response).finish());
        queueMicrotask(() => {
            if (this.behaviour === 'split') {
                const cut = Math.floor(frame.length / 8) * 4;
                this.emit({ frame: frame.slice(0, cut), more: true });
                this.emit({ frame: frame.slice(cut), more: false });
            } else this.emit({ frame, more: false });
        });
    }

    disconnect(): void {
        this.disconnected = true;
    }

    emit(message: unknown): void {
        for (const l of this.messageListeners) l(message);
    }

    crash(reason: string): void {
        this.error = { message: reason };
        for (const l of this.disconnectListeners) l(this);
    }
}

const check = { id: 7, op: 'check', text: 'teh', languageId: 'latex' } as const;

function setup(...behaviours: Behaviour[]) {
    const clock = new FakeClock();
    const hosts: FakeHost[] = [];
    const connect = (name: string): NativePort => {
        expect(name).toBe('language_check');
        const host = new FakeHost(behaviours[Math.min(hosts.length, behaviours.length - 1)] ?? 'answer');
        hosts.push(host);
        return host;
    };
    return { clock, hosts, connection: new CoreConnection('overleaf-abc', connect, clock) };
}

describe('CoreConnection', () => {
    test('initializes the workspace once, then checks', async () => {
        const { hosts, connection } = setup('answer');
        const response = await connection.request(check);
        expect(response).toMatchObject({ id: 7, ok: true, diagnostics: [{ startByte: 0, endByte: 3, suggestions: ['the'] }] });
        await connection.request({ id: 8, op: 'addWord', word: 'teh' });
        expect(hosts).toHaveLength(1);
        expect(hosts[0]!.received.map((r) => r.payload)).toEqual(['initialize', 'checkProse', 'addDictionaryWord']);
        expect(hosts[0]!.received[0]!.initialize?.workspaceRoot).toBe('overleaf-abc');
    });

    test('joins a response split across frames', async () => {
        const { connection } = setup('split');
        expect(await connection.request(check)).toMatchObject({ ok: true, diagnostics: [{ message: 'Possible spelling mistake' }] });
    });

    test('a request the host never answers times out', async () => {
        const { clock, connection } = setup('silent');
        const pending = connection.request(check);
        await Promise.resolve();
        clock.advance(REQUEST_TIMEOUT_MS);
        expect(await pending).toMatchObject({ ok: false, code: 'timeout' });
    });

    test('a missing host fails fast, then is not respawned until the backoff passes', async () => {
        const { clock, hosts, connection } = setup('crash-on-start', 'crash-on-start', 'answer');
        expect(await connection.request(check)).toMatchObject({ ok: false, code: 'unavailable', error: 'Specified native messaging host not found.' });
        // Typing on: no new process during the backoff.
        expect(await connection.request(check)).toMatchObject({ ok: false, code: 'unavailable' });
        expect(hosts).toHaveLength(1);
        clock.advance(1000);
        expect(await connection.request(check)).toMatchObject({ ok: false, code: 'unavailable' });
        expect(hosts).toHaveLength(2);
        // The second failure doubles the wait.
        clock.advance(1000);
        expect(await connection.request(check)).toMatchObject({ ok: false, code: 'unavailable' });
        expect(hosts).toHaveLength(2);
        clock.advance(1000);
        expect(await connection.request(check)).toMatchObject({ ok: true });
        expect(hosts).toHaveLength(3);
    });

    test('a host that dies mid-request fails what was pending, and the next request starts a fresh one', async () => {
        const { hosts, connection } = setup('silent', 'answer');
        const pending = connection.request(check);
        await Promise.resolve();
        hosts[0]!.crash('Native application has exited.');
        expect(await pending).toMatchObject({ ok: false, code: 'unavailable', error: 'Native application has exited.' });
    });

    test('a malformed or oversized frame drops the connection instead of being trusted', async () => {
        for (const bad of [{ frame: 3, more: false }, { frame: '!!!!', more: false }, { nope: true }]) {
            const { hosts, connection } = setup('silent');
            const pending = connection.request(check);
            await Promise.resolve();
            hosts[0]!.emit(bad);
            expect(await pending).toMatchObject({ ok: false, code: 'unavailable' });
            expect(hosts[0]!.disconnected).toBe(true);
        }
    });

    test('a response for an unknown id is ignored', async () => {
        const { hosts, connection, clock } = setup('silent');
        const pending = connection.request(check);
        await Promise.resolve();
        hosts[0]!.emit({ frame: bytesToBase64(languagecheck.Response.encode({ id: 999, ok: {} }).finish()), more: false });
        clock.advance(REQUEST_TIMEOUT_MS);
        expect(await pending).toMatchObject({ code: 'timeout' });
    });
});

describe('CoreManager', () => {
    test('one host per workspace, the least recently used closed past the cap, idle ones swept', async () => {
        const clock = new FakeClock();
        const hosts: FakeHost[] = [];
        const manager = new CoreManager(() => {
            const h = new FakeHost('answer');
            hosts.push(h);
            return h;
        }, clock);
        for (let i = 0; i <= MAX_CONNECTIONS; i++) {
            clock.advance(1);
            await manager.request(`site-${i}`, check);
        }
        expect(manager.size).toBe(MAX_CONNECTIONS);
        expect(hosts[0]!.disconnected).toBe(true);
        clock.advance(IDLE_CLOSE_MS + 1);
        manager.sweep();
        expect(manager.size).toBe(0);
        expect(hosts.every((h) => h.disconnected)).toBe(true);
    });
});
