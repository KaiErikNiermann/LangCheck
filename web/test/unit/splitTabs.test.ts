// Panel tabs open as split partners only where the browser makes splits,
// and open as plain tabs whenever a split is refused or not made.
import { describe, expect, test, vi } from 'vitest';
import { createBeside, GECKO_SPLIT_VERIFIED, SPLIT_VIEW_ID_NONE, splitsHere, type CreatedTab, type Engine, type SplitTabsApi } from '../../src/background/splitTabs';

const OPTIONS = { url: 'chrome-extension://x/webview/speedFix.html', openerTabId: 7, windowId: 2 };

function api(engine: Engine, knowsSplits: boolean, answer: (options: { splitWithTabId?: number }) => Promise<CreatedTab>): SplitTabsApi & { calls: object[] } {
    const calls: object[] = [];
    return {
        engine,
        knowsSplits,
        calls,
        create: (options) => {
            calls.push(options);
            return answer(options);
        },
    };
}

describe('createBeside', () => {
    test('Chromium with split views opens the panel as the page\'s split partner', async () => {
        const tabs = api('chromium', true, () => Promise.resolve({ id: 9, splitViewId: 3 }));
        expect(await createBeside(tabs, OPTIONS)).toEqual({ tab: { id: 9, splitViewId: 3 }, split: true });
        expect(tabs.calls).toEqual([{ ...OPTIONS, splitWithTabId: 7 }]);
    });

    test('a refused split (the page pinned, or split already) opens a plain tab', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const tabs = api('chromium', true, (options) => (options.splitWithTabId === undefined ? Promise.resolve({ id: 9 }) : Promise.reject(new Error('Tabs must be adjacent'))));
        expect(await createBeside(tabs, OPTIONS)).toEqual({ tab: { id: 9 }, split: false });
        expect(tabs.calls).toEqual([{ ...OPTIONS, splitWithTabId: 7 }, OPTIONS]);
    });

    test('a tab handed back unsplit is kept, as a plain tab, and not opened twice', async () => {
        const tabs = api('chromium', true, () => Promise.resolve({ id: 9, splitViewId: SPLIT_VIEW_ID_NONE }));
        expect(await createBeside(tabs, OPTIONS)).toEqual({ tab: { id: 9, splitViewId: SPLIT_VIEW_ID_NONE }, split: false });
        expect(tabs.calls).toHaveLength(1);
    });

    test('a browser without split views is asked for a plain tab', async () => {
        const tabs = api('chromium', false, () => Promise.resolve({ id: 9 }));
        expect(await createBeside(tabs, OPTIONS)).toEqual({ tab: { id: 9 }, split: false });
        expect(tabs.calls).toEqual([OPTIONS]);
    });

    test('Firefox is asked for a plain tab until its split views have been verified', async () => {
        expect(GECKO_SPLIT_VERIFIED).toBe(false);
        const tabs = api('gecko', true, () => Promise.resolve({ id: 9 }));
        expect(await createBeside(tabs, OPTIONS)).toEqual({ tab: { id: 9 }, split: false });
        expect(tabs.calls).toEqual([OPTIONS]);
    });

    test('a plain tab that fails is the failure: nothing else is tried', async () => {
        const tabs = api('chromium', false, () => Promise.reject(new Error('no window')));
        await expect(createBeside(tabs, OPTIONS)).rejects.toThrow('no window');
    });
});

test('splitsHere: Chromium when it knows splits; Firefox only once verified', () => {
    expect(splitsHere({ engine: 'chromium', knowsSplits: true })).toBe(true);
    expect(splitsHere({ engine: 'chromium', knowsSplits: false })).toBe(false);
    expect(splitsHere({ engine: 'gecko', knowsSplits: true })).toBe(GECKO_SPLIT_VERIFIED);
    expect(splitsHere({ engine: 'gecko', knowsSplits: false })).toBe(false);
});
