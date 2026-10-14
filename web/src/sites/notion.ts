// Notion: a block editor of contenteditable leaves, one per block. Which
// leaves are prose is the site's own call, made for the browser's
// spellchecker: prose leaves carry spellcheck="true", code blocks "false"
// (research/notion-editor.md). Notion's class names appear only where no
// standard signal exists: the page frame, and inline code.
import { domEditor } from '../editor/handle';
import { pathSegment, type SiteFiles, type SiteModule, type SitePage, type SiteWorkspace } from './site';

/** Notion URLs: /p/<workspace>/<page>, /<workspace>/<page>, or /<page>, with a 32-hex page id at the end. */
const PAGE_ID = /([0-9a-f]{32})(?:$|[?#])/u;
const WORKSPACE = /^[A-Za-z0-9_-]{1,100}$/u;

/**
 * The workspace a Notion URL is in, which is what the dictionary is keyed
 * by: one dictionary per Notion workspace, not per page.
 */
export function notionWorkspaceFromPath(pathname: string): string | undefined {
    const segments = pathname.split('/').filter((s) => s.length > 0);
    const [first, second] = segments;
    // /p/<workspace>[/<page>]: the workspace is the segment after `p`, never `p` itself.
    if (first === 'p') return second !== undefined && WORKSPACE.test(second) ? second : undefined;
    if (first !== undefined && segments.length >= 2 && WORKSPACE.test(first)) return first;
    // A bare /<page-id> URL names no workspace; it shares the default one.
    return segments.length === 1 && PAGE_ID.test(segments[0] ?? '') ? 'default' : undefined;
}

export const notionWorkspace: SiteWorkspace = { id: 'notion', projectFromPath: notionWorkspaceFromPath };

const PROSE_LEAF = '[data-content-editable-leaf="true"][spellcheck="true"]';
const PAGE_ID_ONLY = /^[0-9a-f]{32}$/u;

/**
 * The page in front, and where it is drawn. A side or centre peek
 * (`?p=<page>&pm=s|c`) draws the peeked page in `.notion-peek-renderer`, over
 * the page in the path, which stays in `.notion-frame` behind it (seen live,
 * research/notion-editor.md): the peek is what the user is editing.
 */
function pageInFront(): { readonly root: Element; readonly page: string } | undefined {
    const peeked = new URLSearchParams(location.search).get('p');
    const peek = document.querySelector('.notion-peek-renderer');
    if (peek !== null && peeked !== null && PAGE_ID_ONLY.test(peeked)) return { root: peek, page: peeked };
    const frame = document.querySelector('.notion-frame');
    const page = PAGE_ID.exec(location.pathname)?.[1];
    return frame === null || page === undefined ? undefined : { root: frame, page };
}

/**
 * A breadcrumb's titles: its ancestors, then the page itself. Notion draws
 * each ancestor as a link (`<a>`) and the page as a `<span>` holding a
 * button, with `/` between them as hidden `<span>`s; after them, in the same
 * row, a `<div>` badge says who can see the page ("Private"), which is no
 * crumb (seen 2026-10-14).
 */
function crumbTitles(crumbs: Element): readonly string[] {
    return [...crumbs.children]
        .filter((crumb) => (crumb.tagName === 'A' || crumb.tagName === 'SPAN') && crumb.getAttribute('aria-hidden') !== 'true')
        .map((crumb) => crumb.textContent.trim());
}

/**
 * The page in front as titles, ancestors first. The topbar's breadcrumb is
 * the page in the path's. A peek draws no breadcrumb of its own (seen
 * 2026-10-14), only its title (`aria-roledescription="page title"`): it is
 * named under the page it opened over, which in a database is its parent.
 */
export function breadcrumbTitles(root: Element): readonly string[] {
    const own = root.querySelector(':scope .shadow-cursor-breadcrumb');
    if (own !== null) return crumbTitles(own);
    const topbar = root.ownerDocument.querySelector(':scope .notion-topbar .shadow-cursor-breadcrumb');
    const behind = topbar === null ? [] : crumbTitles(topbar);
    if (!root.matches('.notion-peek-renderer')) return behind;
    const title = root.querySelector(':scope [aria-roledescription="page title"]')?.textContent.trim();
    return title === undefined ? [] : [...behind, title];
}

/**
 * A Notion page as a file: its breadcrumb as folders, its title as the
 * name, as Markdown (`University Courses/Logical Verification.md`), so an
 * `exclude` of `Journal/**` leaves every page under Journal unchecked.
 * Notion shortens a long breadcrumb to its first and last crumbs with `…`
 * between, and the path is what it shows.
 */
export function notionPagePath(titles: readonly string[]): string | undefined {
    return titles.length === 0 ? undefined : `${titles.map((title) => pathSegment(title)).join('/')}.md`;
}

/** Notion keeps no list of its pages to read: the page open is the one listed. */
const NOTION_FILES: SiteFiles = {
    list: () => Promise.resolve([]),
    note: 'Notion pages are listed as they are opened. A page is the file its breadcrumb names (Parent/Page.md), and a peeked page sits under the page it opened over; include and exclude match these.',
};

export const notionPage: SitePage = {
    id: 'notion',
    files: () => NOTION_FILES,
    findEditor() {
        const front = pageInFront();
        if (front === undefined) return;
        // Markdown, not plaintext: the client's providers attach only to the
        // languages it supports, and Notion's text carries its formatting in
        // the DOM, so markdown extraction sees plain prose.
        return domEditor(
            front.root,
            front.root,
            front.page,
            'markdown',
            {
                leaves: (root) => root.querySelectorAll(PROSE_LEAF),
                // contenteditable="false" is the standard mark of an atom
                // (equations, mentions); inline code is Notion's own container.
                isAtom: (element) => element.getAttribute('contenteditable') === 'false' || element.classList.contains('notion-inline-code-container'),
                darkSelector: '.notion-dark-theme',
            },
            () => notionPagePath(breadcrumbTitles(front.root)),
        );
    },
};

export const site: SiteModule = { workspace: notionWorkspace, createPage: () => notionPage };
