// What differs between the web editors we join. Everything else (the shim,
// the CodeMirror adapter, the bridge, the transport) is shared, so a site is
// only these few facts. Both sites run CodeMirror 6; a site on another
// editor would bring its own EditorAdapter as well.
import type { EditorView } from '@codemirror/view';
import { viewFromContentDom } from '../editor/cm6kit';
import type { EditorHandle } from '../editor/handle';
import type { LanguageId } from '../messaging/protocol';
import type { SiteId } from './catalog';

export type { SiteId } from './catalog';

/** Facts about a site the content script may rely on: they come from the tab's URL, not the page. */
export interface SiteWorkspace {
    readonly id: SiteId;
    /** The project the URL names, which becomes the workspace (and dictionary) the core keeps for it. */
    projectFromPath(pathname: string): string | undefined;
}

/**
 * The dictionary a site keeps for the user (Typst's personal dictionary,
 * Overleaf's learned words), read in the page with the page's own session
 * (research/site-dictionaries.md). The core turns it into words.
 */
export interface SiteDictionarySource {
    /** The site's name, as the core files it. */
    readonly source: string;
    /** Its entries now, or undefined when they cannot be read (signed out, the site changed shape). */
    read(): Promise<readonly string[] | undefined>;
    /** Calls `changed` whenever the dictionary may have changed; returns what stops watching. */
    watch(changed: () => void): () => void;
    /**
     * Adds `word` to it, as the site's own "Add to dictionary" does;
     * undefined once done, else a sentence saying why not.
     */
    add(word: string): Promise<string | undefined>;
}

/**
 * What a site does, exported as `site` from src/sites/<id>.ts: the build's
 * entries start it (src/build/sites.ts), workspaces.ts lists it for the
 * background.
 */
export interface SiteModule {
    readonly workspace: SiteWorkspace;
    /** The page-world half, made in the page (never on import: the background imports the module too). */
    createPage(): SitePage;
}

/** Facts read in the page world, from the site's running editor. */
export interface SitePage {
    readonly id: SiteId;
    /** The editor on the page now, with the document it shows; undefined while there is none. */
    findEditor(): EditorHandle | undefined;
    /** The site's own dictionary, for a site that keeps one. */
    readonly dictionary?: () => SiteDictionarySource;
}

/** Calls `seen` for each request the page makes whose URL `matches`, from now on. */
export function watchRequests(matches: (url: URL) => boolean, seen: (entry: PerformanceEntry) => void): () => void {
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            try {
                if (matches(new URL(entry.name))) seen(entry);
            } catch {
                // Not a URL: nothing of ours.
            }
        }
    });
    observer.observe({ type: 'resource' });
    return () => {
        observer.disconnect();
    };
}

/** `value` as a list of strings, when it is one; other entries dropped. */
export const stringsIn = (value: unknown): readonly string[] | undefined => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined);

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
