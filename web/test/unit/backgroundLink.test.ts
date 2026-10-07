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
