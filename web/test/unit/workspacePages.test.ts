// Which pages a config change reaches: a port counts once its workspace is
// known, and a port that went before then never counts.
import { expect, test } from 'vitest';
import { WorkspacePages } from '../../src/background/workspacePages';

test('a page counts for its workspace until it goes', async () => {
    const pages = new WorkspacePages<string>();
    const leave = pages.add('a', Promise.resolve('w1'));
    pages.add('b', Promise.resolve('w1'));
    await Promise.resolve();
    expect(pages.of('w1')).toEqual(['a', 'b']);
    leave();
    await Promise.resolve();
    expect(pages.of('w1')).toEqual(['b']);
});

test('a page that goes before its workspace is known is never counted', async () => {
    const pages = new WorkspacePages<string>();
    const workspace = Promise.withResolvers<string | undefined>();
    const leave = pages.add('a', workspace.promise);
    leave();
    workspace.resolve('w1');
    await workspace.promise;
    await Promise.resolve();
    expect(pages.of('w1')).toEqual([]);
    expect(pages.size).toBe(0);
});

test('a page with no workspace is not counted, and the last to go takes its workspace along', async () => {
    const pages = new WorkspacePages<string>();
    pages.add('a', Promise.resolve(undefined));
    const leave = pages.add('b', Promise.resolve('w1'));
    await Promise.resolve();
    expect(pages.size).toBe(1);
    leave();
    await Promise.resolve();
    expect(pages.size).toBe(0);
});
