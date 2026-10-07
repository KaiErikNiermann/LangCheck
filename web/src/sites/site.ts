// What differs between the web editors we join. Everything else (the shim,
// the CodeMirror adapter, the bridge, the transport) is shared, so a site is
// only these few facts. Both sites run CodeMirror 6; a site on another
// editor would bring its own EditorAdapter as well.
import type { EditorView } from '@codemirror/view';
import { viewFromContentDom } from '../editor/cm6kit';
import type { EditorHandle } from '../editor/handle';
import type { LanguageId } from '../messaging/protocol';

export type SiteId = 'overleaf' | 'typst' | 'notion';

/** Facts about a site the content script may rely on: they come from the tab's URL, not the page. */
export interface SiteWorkspace {
    readonly id: SiteId;
    /** The project the URL names, which becomes the workspace (and dictionary) the core keeps for it. */
    projectFromPath(pathname: string): string | undefined;
}

/** Facts read in the page world, from the site's running editor. */
export interface SitePage {
    readonly id: SiteId;
    /** The editor on the page now, with the document it shows; undefined while there is none. */
    findEditor(): EditorHandle | undefined;
}

/** Project ids on both sites are URL-safe tokens; anything else is not a project URL. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/u;

/** `/project/<id>` and nothing else: a project page, not the dashboard or settings. */
export function projectFromProjectPath(pathname: string): string | undefined {
    const [, first, id] = pathname.split('/', 3);
    return first === 'project' && id !== undefined && PROJECT_ID.test(id) ? id : undefined;
}

/** The key the native host files a project under (see `WorkspaceKey` in the core). */
export function workspaceKey(site: SiteId, project: string): string {
    return `${site}-${project}`;
}

/** The editor whose content element is in the page; the single-editor case both sites have. */
export function viewInDocument(root: ParentNode = document): EditorView | undefined {
    return viewFromContentDom(root.querySelector('.cm-content'));
}

const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, LanguageId> = new Map([
    ['tex', 'latex'],
    ['sty', 'latex'],
    ['cls', 'latex'],
    ['ltx', 'latex'],
    ['typ', 'typst'],
    ['bib', 'bibtex'],
    ['md', 'markdown'],
    ['txt', 'plaintext'],
]);

export function languageFromName(name: string): LanguageId | undefined {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? undefined : LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
}

/**
 * The language CodeMirror says the editor is in: `@codemirror/language` sets
 * `data-language` on the content element from the active language's name,
 * which is public, documented behaviour rather than a site's internals.
 */
export function languageFromEditor(view: EditorView): LanguageId | undefined {
    switch (view.contentDOM.dataset.language?.toLowerCase()) {
        case 'latex':
        case 'stex':
        case 'tex': {
            return 'latex';
        }
        case 'typst': {
            return 'typst';
        }
        case 'bibtex': {
            return 'bibtex';
        }
        case 'markdown': {
            return 'markdown';
        }
        default: {
            return undefined;
        }
    }
}
