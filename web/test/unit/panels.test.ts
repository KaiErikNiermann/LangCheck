// The background's panel bookkeeping, against fake tabs: which tab a panel
// lives in, who may talk to it, and that every way a panel ends is reported
// once and leaves nothing behind.
import { describe, expect, test } from 'vitest';
import { MAX_QUEUED, Panels, type PanelPort, type TabsApi } from '../../src/background/panels';
import { WEBVIEW_TYPE, type PageToPanel } from '../../src/messaging/webview';

class FakePort implements PanelPort {
    readonly sent: unknown[] = [];
    disconnected = false;
    postMessage(message: unknown): void {
        this.sent.push(message);
    }
    disconnect(): void {
        this.disconnected = true;
    }
}

function fakeTabs(options: { failCreate?: boolean } = {}) {
    let nextTab = 100;
    const created: { url: string; openerTabId: number }[] = [];
    const removed: number[] = [];
    const activated: number[] = [];
    const pending: (() => void)[] = [];
    const tabs: TabsApi = {
        create: (opts) =>
            new Promise((resolve, reject) => {
                created.push(opts);
                pending.push(() => {
                    if (options.failCreate === true) reject(new Error('no'));
                    else resolve({ id: nextTab++ });
                });
            }),
        activate: (tabId) => {
            activated.push(tabId);
            return Promise.resolve();
        },
        remove: (tabId) => {
            removed.push(tabId);
            return Promise.resolve();
        },
        pageUrl: (viewType) => `ext://webview/${viewType}.html`,
    };
    /** Lets the browser finish creating the tabs asked for so far. */
    const settle = async (): Promise<void> => {
        for (const finish of pending.splice(0)) finish();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { tabs, created, removed, activated, settle };
}

const SOURCE = 7;
const open = (panel = 'p1'): PageToPanel => ({ type: WEBVIEW_TYPE, op: 'open', panel, viewType: 'speedFix' });
const post = (message: unknown): PageToPanel => ({ type: WEBVIEW_TYPE, op: 'post', panel: 'p1', message });
const closedMessage = { webview: { type: WEBVIEW_TYPE, op: 'closed', panel: 'p1' } };

describe('Panels', () => {
    test('opens the view type page in a tab beside the page, and delivers what was posted before the tab connected', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        panels.fromPage(SOURCE, page, post({ type: 'loading', payload: true }));
        expect(fake.created).toEqual([{ url: 'ext://webview/speedFix.html', openerTabId: SOURCE }]);
        await fake.settle();

        const tab = new FakePort();
        const handler = panels.panelConnected(100, tab);
        expect(tab.sent).toEqual([{ type: 'loading', payload: true }]);
        panels.fromPage(SOURCE, page, post('later'));
        expect(tab.sent.at(-1)).toBe('later');

        handler?.message({ type: 'ready' });
        expect(page.sent).toEqual([{ webview: { type: WEBVIEW_TYPE, op: 'message', panel: 'p1', message: { type: 'ready' } } }]);
    });

    test('a second open of the same panel opens no second tab', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        expect(fake.created).toHaveLength(1);
    });

    test('refuses a tab it did not open, and a second connection from its own', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        panels.fromPage(SOURCE, new FakePort(), open());
        await fake.settle();
        const stranger = new FakePort();
        expect(panels.panelConnected(999, stranger)).toBeUndefined();
        expect(panels.panelConnected(undefined, new FakePort())).toBeUndefined();
        expect(stranger.disconnected).toBe(true);
        expect(panels.panelConnected(100, new FakePort())).toBeDefined();
        const again = new FakePort();
        expect(panels.panelConnected(100, again)).toBeUndefined();
        expect(again.disconnected).toBe(true);
    });

    test("one page's panel ids do not reach another page's panels", async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        panels.fromPage(SOURCE, new FakePort(), open());
        await fake.settle();
        const tab = new FakePort();
        panels.panelConnected(100, tab);
        const other = new FakePort();
        panels.fromPage(SOURCE + 1, other, post('from elsewhere'));
        panels.fromPage(SOURCE + 1, other, { type: WEBVIEW_TYPE, op: 'close', panel: 'p1' });
        expect(tab.sent).toEqual([]);
        expect(fake.removed).toEqual([]);
        expect(panels.size).toBe(1);
    });

    test('closing the panel tab tells the page, once', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        const handler = panels.panelConnected(100, new FakePort());
        panels.tabRemoved(100);
        handler?.gone();
        expect(page.sent).toEqual([closedMessage]);
        expect(panels.size).toBe(0);
    });

    test('the page closing a panel removes its tab without reporting it back', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        const handler = panels.panelConnected(100, new FakePort());
        panels.fromPage(SOURCE, page, { type: WEBVIEW_TYPE, op: 'close', panel: 'p1' });
        handler?.gone();
        expect(fake.removed).toEqual([100]);
        expect(page.sent).toEqual([]);
        expect(panels.size).toBe(0);
    });

    test('a close before the tab exists removes the tab once it does', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        panels.fromPage(SOURCE, page, { type: WEBVIEW_TYPE, op: 'close', panel: 'p1' });
        await fake.settle();
        expect(fake.removed).toEqual([100]);
        expect(panels.panelConnected(100, new FakePort())).toBeUndefined();
    });

    test("the page going away closes its panels' tabs; a stale port's disconnect does not", async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const old = new FakePort();
        const current = new FakePort();
        panels.fromPage(SOURCE, old, open('p1'));
        panels.fromPage(SOURCE, current, open('p2'));
        await fake.settle();
        panels.sourceGone(SOURCE, old);
        expect(panels.size).toBe(2);
        panels.sourceGone(SOURCE, current);
        expect(fake.removed.toSorted((a, b) => a - b)).toEqual([100, 101]);
        expect(panels.size).toBe(0);
    });

    test('a tab that cannot be created is reported closed', async () => {
        const fake = fakeTabs({ failCreate: true });
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        expect(page.sent).toEqual([closedMessage]);
        expect(panels.size).toBe(0);
    });

    test('keeps only the newest messages for a tab that has not connected', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        for (let i = 0; i < MAX_QUEUED + 10; i++) panels.fromPage(SOURCE, page, post(i));
        await fake.settle();
        const tab = new FakePort();
        panels.panelConnected(100, tab);
        expect(tab.sent).toHaveLength(MAX_QUEUED);
        expect(tab.sent[0]).toBe(10);
    });

    test('drops a panel message that is not plain bounded data', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        const handler = panels.panelConnected(100, new FakePort());
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        handler?.message(cyclic);
        handler?.message(undefined);
        expect(page.sent).toEqual([]);
    });

    test('reveal brings the panel tab forward, focusEditor the page tab', async () => {
        const fake = fakeTabs();
        const panels = new Panels(fake.tabs);
        const page = new FakePort();
        panels.fromPage(SOURCE, page, open());
        await fake.settle();
        panels.fromPage(SOURCE, page, { type: WEBVIEW_TYPE, op: 'reveal', panel: 'p1' });
        panels.fromPage(SOURCE, page, { type: WEBVIEW_TYPE, op: 'focusEditor' });
        expect(fake.activated).toEqual([100, SOURCE]);
    });
});
