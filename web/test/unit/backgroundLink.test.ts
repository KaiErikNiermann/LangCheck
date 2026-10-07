// The content script's link to the background fails at once, not after the
// page's timeout, when the background cannot be reached: after an extension
// update or reload under an open tab, connecting throws.
import { expect, test, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: {} }));

const { BackgroundLink } = await import('../../src/content/content');

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
