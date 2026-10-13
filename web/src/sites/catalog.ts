// Every site the extension runs on, as data: the one list a new site is
// added to. The build derives the rest from it (each site's content and
// page scripts, the manifest's matches and description, the test build's
// stand-in origins: src/build/sites.ts), and the background its table of
// origins (registry.ts). What a site does lives in its module,
// src/sites/<id>.ts, exporting `site` (workspaces.ts holds them to this list).
//
// No imports: the build script loads this file on its own.

/** One site, as the build and the background see it. */
export interface CatalogEntry {
    readonly id: string;
    /** How people know it, for the manifest's description. */
    readonly name: string;
    /** Where it runs: origins, and the paths on them its editor pages are under (match-pattern paths). */
    readonly origins: readonly string[];
    readonly paths: readonly string[];
    /** The end-to-end tests' stand-in: a loopback origin of its own, and its paths. */
    readonly test: { readonly origin: string; readonly paths: readonly string[] };
}

export const SITES = [
    {
        id: 'overleaf',
        name: 'Overleaf',
        origins: ['https://www.overleaf.com'],
        paths: ['/project/*'],
        test: { origin: 'http://127.0.0.1', paths: ['/project/*'] },
    },
    {
        id: 'typst',
        name: 'Typst',
        origins: ['https://typst.app'],
        paths: ['/project/*'],
        test: { origin: 'http://localhost', paths: ['/project/*'] },
    },
    {
        id: 'notion',
        name: 'Notion',
        origins: ['https://app.notion.com', 'https://www.notion.so'],
        paths: ['/*'],
        test: { origin: 'http://127.0.0.2', paths: ['/*'] },
    },
    {
        id: 'gmail',
        name: 'Gmail',
        origins: ['https://mail.google.com'],
        paths: ['/mail/*'],
        test: { origin: 'http://127.0.0.3', paths: ['/mail/*'] },
    },
] as const satisfies readonly CatalogEntry[];

export type SiteId = (typeof SITES)[number]['id'];
