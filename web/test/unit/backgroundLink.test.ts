// The content script's link to the background fails at once, not after the
// page's timeout, when the background cannot be reached: after an extension
// update or reload under an open tab, connecting throws.
import { expect, test, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: {} }));

const { BackgroundLink, PONG_EVERY_MS, servePort } = await import('../../src/content/content');

const request = { id: 7, request: { getMetadata: {} } } as const;

test('a background that cannot be connected to rejects the request at once', async () => {
    const link = new BackgroundLink(
        () => {},
        () => {},
        () => {
            throw new Error('Extension context invalidated.');
        },
        () => 'p1',
    );
    await expect(link.send(request)).rejects.toThrow('Extension context invalidated.');
    // And again: nothing was left waiting from the first.
    await expect(link.send(request)).rejects.toThrow();
    expect(() => {
        link.postWebview({ type: 'webview', op: 'focusEditor' });
    }).not.toThrow();
});

test('a port that throws on posting rejects the request at once', async () => {
    const port = {
        postMessage: () => {
            throw new Error('Attempting to use a disconnected port object');
        },
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
    };
    const link = new BackgroundLink(() => {}, () => {}, () => port as never, () => 'p1');
    await expect(link.send(request)).rejects.toThrow('disconnected port');
});

/** A runtime port the test disconnects, as the browser does when the background stops. */
function fakePort() {
    const disconnected: (() => void)[] = [];
    return {
        postMessage: () => {},
        disconnect: () => {},
        onMessage: { addListener: () => {} },
        onDisconnect: {
            addListener: (listener: () => void) => {
                disconnected.push(listener);
            },
        },
        stop: () => {
            for (const listener of disconnected) listener();
        },
    };
}

test('a request cut off by a background restart is interrupted, not unavailable, and the page checks again once reconnected', async () => {
    vi.useFakeTimers();
    try {
        const ports = [fakePort(), fakePort()];
        let connects = 0;
        let reloads = 0;
        const link = new BackgroundLink(
            () => {},
            () => {},
            () => ports[connects++] as never,
            () => 'p1',
            () => {
                reloads++;
            },
        );
        const answer = link.send(request);
        ports[0]?.stop();
        await expect(answer).resolves.toMatchObject({ id: 7, ok: false, code: 'interrupted' });
        await vi.runAllTimersAsync();
        expect(connects).toBe(2);
        expect(reloads).toBe(1);
    } finally {
        vi.useRealTimers();
    }
});

// Chrome leaves a content script running when its extension is reloaded,
// but cut off for good: retrying the connection forever helps no one.
test('a link cut off by the extension going away stops reconnecting', async () => {
    vi.useFakeTimers();
    const first = fakePort();
    let connects = 0;
    const link = new BackgroundLink(
        () => {},
        () => {},
        () => {
            connects++;
            if (connects === 1) return first as never;
            throw new Error('Extension context invalidated.');
        },
        () => 'p1',
    );
    void link.send(request);
    first.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(connects).toBe(2);
    vi.useRealTimers();
});

// The page world can post pings as fast as it likes: each port gets at most
// one PONG per PONG_EVERY_MS, which still answers the page client's one ping
// per window.
test('pings are answered at most once a second per port', async () => {
    const channel = new MessageChannel();
    let now = 0;
    const link = new BackgroundLink(() => {}, () => {}, () => fakePort() as never, () => 'p1');
    servePort(channel.port1, 1, link, new Set(), { count: 0 }, () => {}, 'overleaf', () => now);
    let pongs = 0;
    channel.port2.addEventListener('message', (event: MessageEvent) => {
        if ((event.data as { type?: string }).type === 'pong') pongs++;
    });
    channel.port2.start();
    const flood = async (): Promise<void> => {
        for (let i = 0; i < 500; i++) channel.port2.postMessage({ type: 'ping' });
        await new Promise((resolve) => setTimeout(resolve, 20));
    };
    await flood();
    expect(pongs).toBe(1);
    now += PONG_EVERY_MS;
    await flood();
    expect(pongs).toBe(2);
    channel.port1.close();
    channel.port2.close();
});
