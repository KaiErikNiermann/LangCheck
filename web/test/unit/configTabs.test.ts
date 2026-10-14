// The config page's tab, when it cannot be opened: the page is told why.
import { expect, test } from 'vitest';
import { ConfigTabs, type ConfigTabsApi } from '../../src/background/configTabs';
import { MAX_OPENS, OpenBudget } from '../../src/background/openBudget';
import type { NotOpenedReason } from '../../src/messaging/webview';

const SOURCE = 7;

function tabs(create: ConfigTabsApi['create']): ConfigTabsApi {
    return { create, activate: () => Promise.resolve(), url: 'config.html' };
}

test('a tab the browser will not create is reported as failed', async () => {
    const heard: NotOpenedReason[] = [];
    const config = new ConfigTabs(tabs(() => Promise.reject(new Error('no'))), new OpenBudget(() => 0));
    config.open(SOURCE, 'overleaf-abc', undefined, (reason) => {
        heard.push(reason);
    });
    await expect.poll(() => heard).toEqual(['failed']);
});

test('past the open budget the page is told it is busy, and no tab is made', () => {
    const budget = new OpenBudget(() => 0);
    for (let i = 0; i < MAX_OPENS; i++) budget.take(SOURCE);
    const heard: NotOpenedReason[] = [];
    let created = 0;
    const config = new ConfigTabs(tabs(() => {
        created++;
        return Promise.resolve({ id: 1 });
    }), budget);
    config.open(SOURCE, 'overleaf-abc', undefined, (reason) => {
        heard.push(reason);
    });
    expect(heard).toEqual(['busy']);
    expect(created).toBe(0);
});

test('a config tab that went away unnoticed is replaced by a new one', async () => {
    const created: string[] = [];
    let nextId = 10;
    const config = new ConfigTabs({
        create: () => {
            created.push('tab');
            return Promise.resolve({ id: nextId++ });
        },
        activate: (tab) => (tab === 10 ? Promise.reject(new Error('No tab with id: 10')) : Promise.resolve()),
        url: 'config.html',
    }, new OpenBudget(() => 0));
    config.open(SOURCE, 'overleaf-abc');
    await expect.poll(() => config.workspaceOf(10)).toBe('overleaf-abc');
    config.open(SOURCE, 'overleaf-abc');
    await expect.poll(() => config.workspaceOf(11)).toBe('overleaf-abc');
    expect(config.workspaceOf(10)).toBeUndefined();
    expect(created).toHaveLength(2);
});
