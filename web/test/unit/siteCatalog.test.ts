// The site catalog is the one list a site is added to: these hold the
// catalog, the sites' modules and what the build derives from it to each
// other, so a site added halfway fails here rather than in a browser.
import { describe, expect, test } from 'vitest';
import { contentScripts, entrySource, resourceMatches, siteMatches, siteNames } from '../../src/build/sites';
import { SITES } from '../../src/sites/catalog';
import { KNOWN_ORIGINS, workspaceForUrl } from '../../src/sites/registry';
import { SITE_MODULES } from '../../src/sites/workspaces';

describe('the catalog', () => {
    test('every site has a module whose workspace is its own', () => {
        for (const entry of SITES) expect(SITE_MODULES[entry.id].workspace.id).toBe(entry.id);
        const byName = (a: string, b: string): number => a.localeCompare(b);
        expect(Object.keys(SITE_MODULES).toSorted(byName)).toEqual(SITES.map((s): string => s.id).toSorted(byName));
    });

    test('ids and origins are each one site\'s; real origins are https, stand-ins loopback', () => {
        const ids = SITES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        const origins = SITES.flatMap((s) => [...s.origins, s.test.origin]);
        expect(new Set(origins).size).toBe(origins.length);
        for (const entry of SITES) {
            for (const origin of entry.origins) expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/u);
            expect(entry.test.origin).toMatch(/^http:\/\/(localhost|127\.0\.0\.\d+)$/u);
            for (const p of [...entry.paths, ...entry.test.paths]) expect(p).toMatch(/^\/.*\*$/u);
        }
    });

    test('the background knows every real origin, and no stand-in outside the test build', () => {
        // vitest builds with __LANGUAGE_CHECK_TEST__ false, as the release does.
        expect(KNOWN_ORIGINS).toEqual(SITES.flatMap((s): string[] => [...s.origins]));
        for (const entry of SITES) expect(workspaceForUrl(`${entry.test.origin}/project/p1`)).toBeUndefined();
    });
});

describe('what the build derives', () => {
    test('each site gets its content script and its page-world script, on its matches', () => {
        const scripts = contentScripts(SITES, false);
        expect(scripts).toHaveLength(SITES.length * 2);
        for (const entry of SITES) {
            const mine = scripts.filter((s) => s.js[0]?.endsWith(`-${entry.id}.js`));
            expect(mine.map((s) => [s.js[0], s.world])).toEqual([
                [`content-${entry.id}.js`, undefined],
                [`page-${entry.id}.js`, 'MAIN'],
            ]);
            for (const s of mine) expect(s.matches).toEqual(siteMatches(entry, false));
        }
    });

    test('the stand-ins are matched only in the test build', () => {
        const gmail = SITES.find((s) => s.id === 'gmail');
        expect(gmail).toBeDefined();
        if (gmail === undefined) return;
        expect(siteMatches(gmail, false)).toEqual(['https://mail.google.com/mail/*']);
        expect(siteMatches(gmail, true)).toEqual(['https://mail.google.com/mail/*', 'http://127.0.0.3/mail/*']);
        expect(resourceMatches(SITES, false).every((m) => m.startsWith('https://') && m.endsWith('/*'))).toBe(true);
        expect(resourceMatches(SITES, true)).toContain('http://127.0.0.3/*');
    });

    test('the description names every site', () => {
        expect(siteNames(SITES)).toBe('Overleaf, Typst, Notion and Gmail');
        expect(siteNames([SITES[0]])).toBe('Overleaf');
    });

    test("a site's entries start its module's `site`", () => {
        expect(entrySource('content', 'gmail', '/src')).toContain('import { site } from "/src/sites/gmail"');
        expect(entrySource('content', 'gmail', '/src')).toContain('startContent(site.workspace)');
        expect(entrySource('page', 'gmail', '/src')).toContain('startPage(site.createPage(), site.workspace)');
    });
});
