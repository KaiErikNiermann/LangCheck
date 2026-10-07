// The extension's own pages keep the background running while open.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isKeepalive, KEEPALIVE_MS, keepBackgroundAlive } from '../../src/messaging/keepalive';

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

test('a keepalive goes out on the current port every interval, and a missing or closed port is skipped', () => {
    const posted: unknown[] = [];
    let port: { postMessage(message: unknown): void } | undefined = {
        postMessage: (m) => {
            posted.push(m);
        },
    };
    keepBackgroundAlive(() => port);
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(posted).toHaveLength(2);
    expect(posted.every(isKeepalive)).toBe(true);
    port = undefined;
    vi.advanceTimersByTime(KEEPALIVE_MS);
    port = {
        postMessage: () => {
            throw new Error('Attempting to use a disconnected port object');
        },
    };
    expect(() => vi.advanceTimersByTime(KEEPALIVE_MS)).not.toThrow();
    expect(posted).toHaveLength(2);
});

test('only a keepalive is one', () => {
    expect(isKeepalive({ type: 'keepalive' })).toBe(true);
    expect([null, undefined, 'keepalive', { type: 'webview' }, { id: 1 }].some((m) => isKeepalive(m))).toBe(false);
});
