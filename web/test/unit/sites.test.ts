import { describe, expect, test } from 'vitest';
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
