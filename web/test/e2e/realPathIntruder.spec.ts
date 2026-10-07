// Another script in the page (the site's, another extension's) can announce
// itself to the content script just as the extension's page script does, and
// get a port of its own. It must not take over: palette commands still reach
// the extension's page script, and its panel ids are its own, so it cannot
// close or feed the real page's panels.
import type { Page } from '@playwright/test';
import { PAGE_READY_TYPE, PROTOCOL_VERSION } from '../../src/messaging/protocol';
import { expect, marks, openPanel, pageUrl, panelPages, status, test } from './fixtures';

/** Announces a second page script and keeps its port on window.__intruder. */
async function intrude(page: Page): Promise<void> {
    await page.evaluate(
        ([ready, version]) =>
            new Promise<void>((resolve) => {
                // Playing the intruder: any page script can listen like this.
                // eslint-disable-next-line sonarjs/post-message -- see above
                window.addEventListener('message', function take(event: MessageEvent) {
                    const port = event.ports[0];
                    if (port === undefined) return;
                    window.removeEventListener('message', take);
                    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the intruder's handle, for the test
                    (globalThis as any).__intruder = port;
                    port.start();
                    resolve();
                });
                window.postMessage({ type: ready, version }, location.origin);
            }),
        [PAGE_READY_TYPE, PROTOCOL_VERSION] as const,
    );
}

test("a second page script gets no palette commands of its own, nor the real page's panels", async ({ page, context }) => {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['recieve']);
    await intrude(page);

    await page.locator('.cm-content').click();
    // The command reaches the extension's page script, which opens the panel.
    const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
    await expect(panel.locator('.error-text')).toHaveText('recieve');

    // The intruder names the real page's first panel id: in its own scope, it is no panel.
    await page.evaluate(() => {
        (globalThis as any).__intruder.postMessage({ type: 'webview', op: 'close', panel: 'p1' });
    });
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- a close that does nothing has no event to wait on
    await page.waitForTimeout(1000);
    expect(panelPages(context, 'speedFix')).toHaveLength(1);
});
