import { describe, expect, it } from 'vitest';

import { Reloader, type ReloadDeps } from '../checking/reload';

/** A core whose Initialize answers only when the test says so. */
function harness() {
    const pending: Array<() => void> = [];
    const events: string[] = [];
    const nothing = () => undefined;
    const deps = {
        log: { debug: nothing, info: nothing, warn: nothing, error: nothing },
        core: {
            initialize: () => {
                events.push('initialize');
                return new Promise<void>(resolve => pending.push(resolve));
            },
        },
        store: { clear: () => events.push('clear') },
        results: { clearDocuments: nothing },
        statusBars: {},
        inspector: { update: async () => undefined, refreshConfigScope: async () => undefined },
        checker: { check: nothing, invalidate: nothing },
        isCheckable: () => true,
    } as unknown as ReloadDeps;
    return { reloader: new Reloader(deps), pending, events };
}

/** Let the queued microtasks run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Reloader', () => {
    it('runs one reload at a time, and a burst of requests queues just one more', async () => {
        const { reloader, pending, events } = harness();

        const first = reloader.reinitializeAndRecheck();
        const second = reloader.reinitializeAndRecheck();
        const third = reloader.reinitializeAndRecheck();
        await settle();
        // Overlapping, the second Initialize was sent before the first had
        // been answered, and the core applied them in either order.
        expect(events).toEqual(['initialize']);
        expect(second).toBe(third);

        pending[0]!();
        await first;
        await settle();
        expect(events).toEqual(['initialize', 'clear', 'initialize']);

        pending[1]!();
        await Promise.all([second, third]);
        expect(events).toEqual(['initialize', 'clear', 'initialize', 'clear']);
    });

    it('starts afresh once the queue has drained', async () => {
        const { reloader, pending, events } = harness();

        const first = reloader.reinitializeAndRecheck();
        await settle();
        pending[0]!();
        await first;

        const later = reloader.reinitializeAndRecheck();
        await settle();
        expect(events).toEqual(['initialize', 'clear', 'initialize']);
        pending[1]!();
        await later;
    });

    it('still runs the queued reload when the one before it failed', async () => {
        const { reloader, events } = harness();
        let calls = 0;
        (reloader as unknown as { deps: { core: { initialize: () => Promise<void> } } }).deps.core.initialize = () => {
            calls++;
            events.push('initialize');
            return calls === 1 ? Promise.reject(new Error('core restarting')) : Promise.resolve();
        };

        const failed = reloader.reinitializeAndRecheck();
        const queued = reloader.reinitializeAndRecheck();
        await expect(failed).rejects.toThrow('core restarting');
        await queued;

        expect(events).toEqual(['initialize', 'initialize', 'clear']);
    });
});
