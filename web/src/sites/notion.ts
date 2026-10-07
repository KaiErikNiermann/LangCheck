// Notion: a block editor of contenteditable leaves, one per block. Which
// leaves are prose is the site's own call, made for the browser's
// spellchecker: prose leaves carry spellcheck="true", code blocks "false"
// (research/notion-editor.md). Notion's class names appear only where no
// standard signal exists: the page frame, and inline code.
import { domEditor } from '../editor/handle';
import type { SitePage, SiteWorkspace } from './site';

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

export const notionPage: SitePage = {
    id: 'notion',
    findEditor() {
        const frame = document.querySelector('.notion-frame');
        const page = PAGE_ID.exec(location.pathname)?.[1];
        if (frame === null || page === undefined) return;
        // Markdown, not plaintext: the client's providers attach only to the
        // languages it supports, and Notion's text carries its formatting in
        // the DOM, so markdown extraction sees plain prose.
        return domEditor(frame, frame, page, 'markdown', {
            leaves: (root) => root.querySelectorAll(PROSE_LEAF),
            // contenteditable="false" is the standard mark of an atom
            // (equations, mentions); inline code is Notion's own container.
            isAtom: (element) => element.getAttribute('contenteditable') === 'false' || element.classList.contains('notion-inline-code-container'),
            darkSelector: '.notion-dark-theme',
        });
    },
};
