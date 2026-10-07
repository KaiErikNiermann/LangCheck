import { describe, expect, test } from 'vitest';
import { notionWorkspaceFromPath } from '../../src/sites/notion';
import { workspaceForUrl } from '../../src/sites/registry';
import { languageFromName, projectFromProjectPath, workspaceKey } from '../../src/sites/site';

describe('projectFromProjectPath', () => {
    test.each([
        ['/project/691fc1336049c31a479401d0', '691fc1336049c31a479401d0'],
        ['/project/pyfJbNtagVZWDPWs5i1S1O', 'pyfJbNtagVZWDPWs5i1S1O'],
        ['/project/abc/settings', 'abc'],
    ])('%s names %s', (path, project) => { expect(projectFromProjectPath(path)).toBe(project); });

    test.each(['/', '/project', '/project/', '/projects/abc', '/project/..', '/project/a%2Fb', '/dashboard/project/abc'])('%s names no project', (path) => { expect(projectFromProjectPath(path)).toBeUndefined(); },
    );

    test('keys are what the native host accepts', () => {
        expect(workspaceKey('overleaf', 'abc')).toMatch(/^(?!\.)[A-Za-z0-9._-]{1,128}$/u);
    });
});

test('languageFromName reads the extension, case-insensitively', () => {
    expect(languageFromName('main.TEX')).toBe('latex');
    expect(languageFromName('refs.bib')).toBe('bibtex');
    expect(languageFromName('doc.typ')).toBe('typst');
    expect(languageFromName('Makefile')).toBeUndefined();
});

describe('workspaceForUrl (what the background trusts)', () => {
    test.each([
        ['https://www.overleaf.com/project/691fc1336049c31a479401d0', 'overleaf-691fc1336049c31a479401d0'],
        ['https://typst.app/project/pyfJbNtagVZWDPWs5i1S1O?x=1#y', 'typst-pyfJbNtagVZWDPWs5i1S1O'],
    ])('%s is %s', (url, key) => expect(workspaceForUrl(url)).toBe(key));

    test.each([
        undefined,
        'not a url',
        'https://www.overleaf.com/dashboard',
        'http://www.overleaf.com/project/abc',
        'https://evil.example/project/abc',
        'https://www.overleaf.com.evil.example/project/abc',
        // The test build's stand-ins are compiled out of the release build.
        'http://127.0.0.1/project/abc',
        'http://localhost/project/abc',
    ])('%s is no workspace', (url) => expect(workspaceForUrl(url)).toBeUndefined());
});

describe('notionWorkspaceFromPath', () => {
    test.each([
        ['/p/applesauce-notes/tests-3f2b8b37e541802f96a1c557a6b01a44', 'applesauce-notes'],
        ['/applesauce-notes/Misc-aa24b3e9dafd4deb8617a6a09693570f', 'applesauce-notes'],
        ['/3f2b8b37e541802f96a1c557a6b01a44', 'default'],
    ])('%s is workspace %s', (path, workspace) => expect(notionWorkspaceFromPath(path)).toBe(workspace));

    test('a /p/<workspace> URL names the segment after p', () => expect(notionWorkspaceFromPath('/p/x')).toBe('x'));

    test.each(['/', '/p', '/login', '/p/../x/y', '/p/a b/c'])('%s is no workspace', (path) => expect(notionWorkspaceFromPath(path)).toBeUndefined());

    test('the background accepts Notion origins and nothing that only resembles them', () => {
        expect(workspaceForUrl('https://app.notion.com/p/applesauce-notes/tests-3f2b8b37e541802f96a1c557a6b01a44')).toBe('notion-applesauce-notes');
        expect(workspaceForUrl('https://www.notion.so/team/Page-3f2b8b37e541802f96a1c557a6b01a44')).toBe('notion-team');
        expect(workspaceForUrl('https://notion.so.evil.example/team/Page-3f2b8b37e541802f96a1c557a6b01a44')).toBeUndefined();
        expect(workspaceForUrl('http://127.0.0.2/p/test-workspace/tests-3f2b8b37e541802f96a1c557a6b01a44')).toBeUndefined();
    });
});
