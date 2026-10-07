// An MV3 background is stopped when idle and started again on the next
// event; everything the extension holds in it is gone. Pages outlive it:
// they must reconnect and carry on, without telling the user the checker
// is missing (it is not). The config page's half is in realPathConfig.
import { backgroundStopper, expect, host, marks, openPanel, pageUrl, panelPages, status, stopBackground, test } from './fixtures';

test('a check cut off by a stop is checked again after it, and no fault is shown', async ({ page }) => {
    await page.goto(pageUrl('overleaf', 'current', 'Start.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    const stop = await backgroundStopper(page);
    // Long enough that its check is still on its way when the background stops.
    await host(page, 'switchFile', 'doc-long', 'long.tex', `I will recieve it. ${'Plain words about the weather. '.repeat(4000)}`);
    // A toast shows for a few seconds: watched for from the stop on.
    const faultShown = page
        .locator('.lc-toast', { hasText: 'cannot reach' })
        .waitFor({ timeout: 10_000 })
        .then(
            () => true,
            () => false,
        );
    await stop();
    await expect(marks(page).filter({ hasText: /^recieve$/u })).toHaveCount(1, { timeout: 30_000 });
    expect(await faultShown).toBe(false);
});

test('after a stop, SpeedFix opens again and fixes', async ({ page, context }) => {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect(marks(page)).toHaveText(['recieve']);
    await page.locator('.cm-content').click();
    await openPanel(page, 'Open SpeedFix', 'speedFix');
    await stopBackground(page);
    // A stop closes the panel's port: its tab goes, and the page knows it.
    await expect.poll(() => panelPages(context, 'speedFix')).toHaveLength(0);
    await page.locator('.cm-content').click();
    const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
    await expect(panel.locator('.error-text')).toHaveText('recieve');
    await panel.keyboard.press('1');
    await expect.poll(() => page.evaluate(() => (globalThis as any).__host.text() as string)).toBe('I will receive it.');
});
