// Which origin is which site, as the background sees it. The background
// derives a request's workspace from the port's `sender.url`, which the
// browser reports and nothing in a page can forge, rather than from
// anything inside the message.
import { notionWorkspace } from './notion';
import { overleafWorkspace } from './overleaf';
import { workspaceKey, type SiteWorkspace } from './site';
import { typstWorkspace } from './typst';

declare const __LANGUAGE_CHECK_TEST__: boolean;

const ORIGINS: ReadonlyMap<string, SiteWorkspace> = new Map([
    ['https://www.overleaf.com', overleafWorkspace],
    ['https://typst.app', typstWorkspace],
    ['https://app.notion.com', notionWorkspace],
    ['https://www.notion.so', notionWorkspace],
    // The end-to-end tests' stand-in pages; compiled out of the release build.
    ...(__LANGUAGE_CHECK_TEST__
        ? ([
              ['http://127.0.0.1', overleafWorkspace],
              ['http://localhost', typstWorkspace],
              ['http://127.0.0.2', notionWorkspace],
          ] as const)
        : []),
]);

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
