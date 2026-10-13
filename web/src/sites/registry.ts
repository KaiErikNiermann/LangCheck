// Which origin is which site, as the background sees it. The background
// derives a request's workspace from the port's `sender.url`, which the
// browser reports and nothing in a page can forge, rather than from
// anything inside the message.
import { SITES } from './catalog';
import { workspaceKey, type SiteWorkspace } from './site';
import { SITE_MODULES } from './workspaces';

declare const __LANGUAGE_CHECK_TEST__: boolean;

/** Each origin's site, from the catalog; the end-to-end stand-ins' only in the test build. */
const ORIGINS: ReadonlyMap<string, SiteWorkspace> = new Map(
    SITES.flatMap((entry) => {
        const { workspace } = SITE_MODULES[entry.id];
        const origins: readonly string[] = __LANGUAGE_CHECK_TEST__ ? [...entry.origins, entry.test.origin] : entry.origins;
        return origins.map((origin) => [origin, workspace] as const);
    }),
);

/** The origins the background files tabs from, in this build. */
export const KNOWN_ORIGINS: readonly string[] = [...ORIGINS.keys()];

/** The workspace key for a tab at `url`, or undefined when it is not a page of a known site that names one. */
export function workspaceForUrl(url: string | undefined): string | undefined {
    if (url === undefined) return undefined;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }
    // Ports do not matter to a site's identity (the tests serve on one).
    const site = ORIGINS.get(`${parsed.protocol}//${parsed.hostname}`);
    const project = site?.projectFromPath(parsed.pathname);
    return site === undefined || project === undefined ? undefined : workspaceKey(site.id, project);
}
