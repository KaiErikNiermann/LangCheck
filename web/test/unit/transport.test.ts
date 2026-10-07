// What the page makes of the content script's failures: an interrupted
// request is dropped quietly, an unavailable host is reported once.
import { expect, test, vi } from 'vitest';
import type { PageResponse } from '../../src/messaging/protocol';
import { WebCore } from '../../src/page/transport';

function transport(response: PageResponse) {
    const events = { unavailable: vi.fn(), recovered: vi.fn(), tooLong: vi.fn() };
    const core = new WebCore({ request: () => Promise.resolve(response) } as never, events);
    return { events, transport: core.client };
}

test('an interrupted request reads as no answer, and nothing is reported', async () => {
    const { events, transport: t } = transport({ id: 1, ok: false, code: 'interrupted', error: 'the extension background restarted' });
    await expect(t.sendRequest({ getMetadata: {} })).resolves.toEqual({ id: 0 });
    expect(events.unavailable).not.toHaveBeenCalled();
    expect(t.isRunning).toBe(true);
    t.dispose();
});

test('an unavailable host is reported', async () => {
    const { events, transport: t } = transport({ id: 1, ok: false, code: 'unavailable', error: 'not installed' });
    await t.sendRequest({ getMetadata: {} });
    expect(events.unavailable).toHaveBeenCalledWith('not installed');
    expect(t.isRunning).toBe(false);
    t.dispose();
});
