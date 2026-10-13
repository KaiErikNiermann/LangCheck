// What the page makes of the content script's failures: an interrupted
// request is dropped quietly, an unavailable host is reported once.
import { expect, test, vi } from 'vitest';
import type { PageResponse } from '../../src/messaging/protocol';
import { WebCore } from '../../src/page/transport';

function transport(response: PageResponse, writeToSite: (source: string, word: string) => Promise<string | undefined> = () => Promise.resolve(undefined)) {
    const events = { unavailable: vi.fn(), recovered: vi.fn(), tooLong: vi.fn(), writeToSite: vi.fn(writeToSite) };
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

// "Add to dictionary" with dictionaries.add_to: site: the core answers with
// the site to write to, which only the page can reach.
test('a site write is made here, and the add reads as done', async () => {
    const { events, transport: t } = transport({ id: 1, ok: true, response: { siteWrite: { source: 'typst', word: 'Wrodle' } } });
    await expect(t.sendRequest({ addDictionaryWord: { word: 'Wrodle' } })).resolves.toEqual({ id: 0, ok: {} });
    expect(events.writeToSite).toHaveBeenCalledWith('typst', 'Wrodle');
    t.dispose();
});

test('a site write that fails reads as the add failing, with why', async () => {
    const full = "Typst's personal dictionary is full (100 words); remove some in Typst's settings first.";
    const { transport: t } = transport({ id: 1, ok: true, response: { siteWrite: { source: 'typst', word: 'Wrodle' } } }, () => Promise.resolve(full));
    await expect(t.sendRequest({ addDictionaryWord: { word: 'Wrodle' } })).resolves.toEqual({ id: 0, error: { message: full } });
    t.dispose();
});

test('an ordinary answer passes through without a site write', async () => {
    const { events, transport: t } = transport({ id: 1, ok: true, response: { ok: {} } });
    await expect(t.sendRequest({ addDictionaryWord: { word: 'Wrodle' } })).resolves.toEqual({ ok: {} });
    expect(events.writeToSite).not.toHaveBeenCalled();
    t.dispose();
});

