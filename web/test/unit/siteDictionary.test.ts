// @vitest-environment happy-dom
// The site's own dictionary: read in the page (Overleaf's meta tag, Typst's
// user settings), kept in step with the core, sent only when it changed.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parsePageRequest } from '../../src/messaging/protocol';
import { MIN_READ_INTERVAL_MS, syncSiteDictionary } from '../../src/page/siteDictionary';
import { learnedWordsIn } from '../../src/sites/overleaf';
import type { SiteDictionarySource } from '../../src/sites/site';
import { personalDictionaryIn } from '../../src/sites/typst';

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

/** A site whose dictionary the test sets, and whose change signal it fires. */
function fakeSite(initial: readonly string[] | undefined) {
    let words = initial;
    let signal: (() => void) | undefined;
    let reads = 0;
    let fail = false;
    const source: SiteDictionarySource = {
        source: 'typst',
        read: () => {
            reads++;
            return fail ? Promise.reject(new Error('offline')) : Promise.resolve(words);
        },
        add: () => Promise.resolve(undefined),
        watch(changed) {
            signal = changed;
            return () => {
                signal = undefined;
            };
        },
    };
    return {
        source,
        set: (next: readonly string[] | undefined) => {
            words = next;
        },
        failing: (on: boolean) => {
            fail = on;
        },
        signal: () => signal?.(),
        reads: () => reads,
        watching: () => signal !== undefined,
    };
}

function harness(site: ReturnType<typeof fakeSite>) {
    const sent: string[][] = [];
    const warnings: string[] = [];
    let changes = 0;
    const sync = syncSiteDictionary(site.source, {
        send: (_source, words) => {
            sent.push([...words]);
            return Promise.resolve(true);
        },
        changed: () => {
            changes++;
        },
        warn: (message) => {
            warnings.push(message);
        },
    });
    return { sync, sent, warnings, changes: () => changes };
}

test('sends the list at once, then again only when the site signals and it changed', async () => {
    const site = fakeSite(['Databricks', 'Vrije']);
    const { sent, changes } = harness(site);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([['Databricks', 'Vrije']]);
    expect(changes()).toBe(1);

    // A signal with nothing changed: read, not sent.
    site.signal();
    await vi.runAllTimersAsync();
    expect(site.reads()).toBe(2);
    expect(sent).toHaveLength(1);

    site.set(['Databricks', 'Vrije', 'Vue']);
    site.signal();
    await vi.runAllTimersAsync();
    expect(sent.at(-1)).toEqual(['Databricks', 'Vrije', 'Vue']);
    expect(changes()).toBe(2);
});

test('a burst of signals is one read, no sooner than the interval after the last', async () => {
    const site = fakeSite(['a']);
    harness(site);
    await vi.runAllTimersAsync();
    for (let i = 0; i < 10; i++) site.signal();
    await vi.advanceTimersByTimeAsync(MIN_READ_INTERVAL_MS - 1);
    expect(site.reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(site.reads()).toBe(2);
});

test('an unreadable dictionary sends nothing and is read again on the next signal', async () => {
    const site = fakeSite(undefined);
    const { sent, warnings } = harness(site);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
    site.failing(true);
    site.signal();
    await vi.runAllTimersAsync();
    expect(warnings).toEqual(['could not read the typst dictionary']);
    site.failing(false);
    site.set(['Vue']);
    site.signal();
    await vi.runAllTimersAsync();
    expect(sent).toEqual([['Vue']]);
});

test('a list the core did not take is sent again on the next read', async () => {
    const site = fakeSite(['Vue']);
    let accept = false;
    const sent: string[][] = [];
    syncSiteDictionary(site.source, {
        send: (_s, words) => {
            sent.push([...words]);
            return Promise.resolve(accept);
        },
        changed: () => {},
        warn: () => {},
    });
    await vi.runAllTimersAsync();
    accept = true;
    site.signal();
    await vi.runAllTimersAsync();
    expect(sent).toEqual([['Vue'], ['Vue']]);
});

test('refresh reads again without a signal from the site: after this page wrote to it', async () => {
    const site = fakeSite(['a']);
    const { sync, sent } = harness(site);
    await vi.runAllTimersAsync();
    site.set(['a', 'Wrodle']);
    sync.refresh();
    await vi.runAllTimersAsync();
    expect(sent.at(-1)).toEqual(['a', 'Wrodle']);
});

test('dispose stops watching and reading', async () => {
    const site = fakeSite(['a']);
    const { sync } = harness(site);
    await vi.runAllTimersAsync();
    sync.dispose();
    expect(site.watching()).toBe(false);
});

test("Overleaf's learned words come from the page's meta tag", () => {
    const page = (content: string | undefined) => new DOMParser().parseFromString(content === undefined ? '<head></head>' : `<head><meta name="ol-learnedWords" content='${content}'></head>`, 'text/html');
    expect(learnedWordsIn(page('["Databricks","Vrije",3]'))).toEqual(['Databricks', 'Vrije']);
    expect(learnedWordsIn(page('[]'))).toEqual([]);
    expect(learnedWordsIn(page('not json'))).toBeUndefined();
    expect(learnedWordsIn(page('{"a":1}'))).toBeUndefined();
    expect(learnedWordsIn(page(undefined))).toBeUndefined();
});

test("Typst's personal dictionary comes from the user settings, a JSON string", () => {
    const answer = (settings: unknown) => ({ data: { user: { settings } } });
    expect(personalDictionaryIn(answer(JSON.stringify({ vim: false, personalDictionary: ['Databricks', 1, 'Vue'] })))).toEqual(['Databricks', 'Vue']);
    expect(personalDictionaryIn(answer(JSON.stringify({ vim: false })))).toBeUndefined();
    expect(personalDictionaryIn(answer('{broken'))).toBeUndefined();
    expect(personalDictionaryIn({ data: { user: null } })).toBeUndefined();
    expect(personalDictionaryIn({ errors: [{ message: 'unauthenticated' }] })).toBeUndefined();
});

test('the page may send a site dictionary: a site name, and entries that are strings', () => {
    const req = (siteDictionary: unknown) => parsePageRequest({ id: 1, request: { siteDictionary } })?.request;
    expect(req({ source: 'typst', words: ['Vue', 3, 'x'.repeat(257), 'New York'] })).toEqual({ siteDictionary: { source: 'typst', words: ['Vue', 'New York'] } });
    expect(req({ source: 'Typst', words: [] })).toBeUndefined();
    expect(req({ source: 'typst', words: 'Vue' })).toBeUndefined();
});
