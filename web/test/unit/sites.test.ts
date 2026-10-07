import { describe, expect, test } from 'vitest';
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
