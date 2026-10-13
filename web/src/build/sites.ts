// What the build makes of the site catalog (src/sites/catalog.ts): every
// site's two scripts, the manifest's content_scripts and resource matches,
// its description. Pure, so the build script and the unit tests run the
// same derivation; esbuild.mjs loads this file through esbuild.
import type { CatalogEntry } from '../sites/catalog';

export interface ContentScript {
    readonly matches: string[];
    readonly js: string[];
    readonly run_at: 'document_idle';
    readonly world?: 'MAIN';
}

/** The match patterns a site's scripts run on; the test build adds its stand-in's. */
export function siteMatches(site: CatalogEntry, test: boolean): string[] {
    const real = site.origins.flatMap((origin) => site.paths.map((path) => `${origin}${path}`));
    return test ? [...real, ...site.test.paths.map((path) => `${site.test.origin}${path}`)] : real;
}

/** Each site's isolated content script and its page-world script, in catalog order. */
export function contentScripts(sites: readonly CatalogEntry[], test: boolean): ContentScript[] {
    return sites.flatMap((site) => {
        const matches = siteMatches(site, test);
        return [
            { matches, js: [`content-${site.id}.js`], run_at: 'document_idle' as const },
            { matches, js: [`page-${site.id}.js`], run_at: 'document_idle' as const, world: 'MAIN' as const },
        ];
    });
}

/** Whole origins (path /*), as web_accessible_resources must match. */
export function resourceMatches(sites: readonly CatalogEntry[], test: boolean): string[] {
    const origins = sites.flatMap((site) => (test ? [...site.origins, site.test.origin] : site.origins));
    return [...new Set(origins)].map((origin) => `${origin}/*`).toSorted((a, b) => a.localeCompare(b));
}

/** "Overleaf, Typst, Notion and Gmail". */
export function siteNames(sites: readonly CatalogEntry[]): string {
    const names = sites.map((site) => site.name);
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** The virtual entry module for a site's script: its module's `site`, started. */
export function entrySource(kind: 'content' | 'page', id: string, srcDir: string): string {
    const module = (relative: string): string => JSON.stringify(`${srcDir}/${relative}`);
    const sitePath = module(`sites/${id}`);
    const site = `import { site } from ${sitePath};`;
    const start =
        kind === 'content'
            ? [`import { startContent } from ${module('content/content')};`, site, 'startContent(site.workspace);']
            : [`import { startPage } from ${module('page/startPage')};`, site, 'startPage(site.createPage(), site.workspace);'];
    return `${start.join('\n')}\n`;
}
