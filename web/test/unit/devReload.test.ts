// The dev build's reloader: it reloads for a build other than its own, once,
// and never acts on anything else it hears; the watcher's server speaks only
// to extensions.
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { startDevServer } from '../../src/build/devServer.mjs';
import { devBuildFile, isExtensionOrigin, parseDevBuild } from '../../src/dev/protocol';
import type { ReloadDeps, SocketEvents } from '../../src/dev/reloadClient';

vi.mock('webextension-polyfill', () => ({ default: {} }));

const { KEEPALIVE_MS, startDevReload } = await import('../../src/dev/reloadClient');

describe('parseDevBuild', () => {
    test('a build announcement, and nothing else', () => {
        expect(parseDevBuild('{"type":"build","id":"mfx2k-3"}')).toEqual({ type: 'build', id: 'mfx2k-3' });
        for (const text of ['{"type":"build","id":"<script>"}', '{"type":"eval","id":"a"}', 'not json', `{"type":"build","id":"${'a'.repeat(300)}"}`, 42]) {
            expect(parseDevBuild(text)).toBeUndefined();
        }
        expect(parseDevBuild(devBuildFile('a-1').replace('{', '{"type":"build",'))).toEqual({ type: 'build', id: 'a-1' });
    });

    test('only extensions are origins the watcher answers', () => {
        expect(isExtensionOrigin('moz-extension://0d4b0d1e-7c1a-4b5e-9a8e-0c3f6f1d2a11')).toBe(true);
        expect(isExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
        for (const origin of ['https://www.overleaf.com', 'http://127.0.0.1:4180', 'null', undefined, 'chrome-extension://x/../evil']) expect(isExtensionOrigin(origin)).toBe(false);
    });
});

/** A reloader on fakes: the socket it opened, what it did, and the timers it set. */
function harness(own: string | undefined, reinjects = true) {
    const sockets: { events: SocketEvents; sent: string[]; open: boolean }[] = [];
    const did: string[] = [];
    const timers: { run: () => void; ms: number }[] = [];
    const repeating: { run: () => void; ms: number }[] = [];
    const deps: ReloadDeps = {
        ownBuild: () => Promise.resolve(own),
        connect(_url, events) {
            const socket = { events, sent: [] as string[], open: false };
            sockets.push(socket);
            return { isOpen: () => socket.open, send: (data) => { socket.sent.push(data); } };
        },
        reload: () => { did.push('reload'); },
        reinjects,
        askTabRefresh: () => { did.push('ask tab refresh'); return Promise.resolve(); },
        refreshTabsIfAsked: () => { did.push('refresh tabs if asked'); return Promise.resolve(); },
        keepAwake: () => { did.push('keep awake'); return Promise.resolve(); },
        setTimer: (run, ms) => { timers.push({ run, ms }); },
        setRepeating: (run, ms) => { repeating.push({ run, ms }); },
        log: () => {},
    };
    startDevReload(deps);
    return { sockets, did, timers, repeating };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const build = (id: string) => JSON.stringify({ type: 'build', id });

describe('startDevReload', () => {
    test('its own build is no news; another one reloads, once', async () => {
        const { sockets, did } = harness('a-1');
        await settle();
        const socket = sockets[0];
        if (socket === undefined) throw new Error('no socket');
        socket.events.open();
        socket.events.message(build('a-1'));
        socket.events.message('{"type":"run","code":"x"}');
        expect(did).not.toContain('reload');
        socket.events.message(build('b-2'));
        socket.events.message(build('c-3'));
        await settle();
        expect(did.filter((d) => d === 'reload')).toHaveLength(1);
    });

    test('in Chrome, the next background is asked to reload the site tabs first', async () => {
        const { sockets, did } = harness('a-1', false);
        await settle();
        sockets[0]?.events.message(build('b-2'));
        await settle();
        expect(did.slice(-2)).toEqual(['ask tab refresh', 'reload']);
    });

    test('a build with no id of its own never connects', async () => {
        const { sockets } = harness(undefined);
        await settle();
        expect(sockets).toHaveLength(0);
    });

    test('a closed socket is opened again, later each time, up to a cap', async () => {
        const { sockets, timers } = harness('a-1');
        await settle();
        for (let i = 0; i < 6; i++) {
            sockets.at(-1)?.events.close();
            timers.at(-1)?.run();
        }
        expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
        expect(sockets).toHaveLength(7);
    });

    test('keeps the background awake, and pings while connected', async () => {
        const { sockets, did, repeating } = harness('a-1');
        await settle();
        expect(repeating.map((r) => r.ms)).toEqual([KEEPALIVE_MS]);
        const socket = sockets[0];
        if (socket === undefined) throw new Error('no socket');
        repeating[0]?.run();
        expect(socket.sent).toEqual([]);
        socket.open = true;
        repeating[0]?.run();
        expect(socket.sent).toEqual(['ping']);
        expect(did.filter((d) => d === 'keep awake')).toHaveLength(2);
    });
});

describe('the watcher', () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    const connect = (port: number, origin: string) =>
        new Promise<{ ok: boolean; first?: string }>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`, { origin });
            ws.once('message', (data: Buffer) => { resolve({ ok: true, first: data.toString() }); ws.close(); });
            ws.once('error', () => { resolve({ ok: false }); });
        });

    test('tells a connecting extension the current build, and refuses a web page', async () => {
        const server = await startDevServer({ host: '127.0.0.1', port: 0, isExtensionOrigin });
        close = server.close;
        server.announce(build('a-1'));
        await expect(connect(server.port, 'moz-extension://0d4b0d1e-7c1a-4b5e-9a8e-0c3f6f1d2a11')).resolves.toEqual({ ok: true, first: build('a-1') });
        await expect(connect(server.port, 'https://www.overleaf.com')).resolves.toEqual({ ok: false });
    });

    test('announces each build to those connected', async () => {
        const server = await startDevServer({ host: '127.0.0.1', port: 0, isExtensionOrigin });
        close = server.close;
        const heard = vi.fn();
        const ws = new WebSocket(`ws://127.0.0.1:${String(server.port)}`, { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
        await new Promise((resolve) => ws.once('open', resolve));
        ws.on('message', (data: Buffer) => { heard(data.toString()); });
        server.announce(build('b-2'));
        await vi.waitFor(() => { expect(heard).toHaveBeenCalledWith(build('b-2')); });
        ws.close();
    });
});
