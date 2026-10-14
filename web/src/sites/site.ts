// What differs between the web editors we join. Everything else (the shim,
// the CodeMirror adapter, the bridge, the transport) is shared, so a site is
// only these few facts. Both sites run CodeMirror 6; a site on another
// editor would bring its own EditorAdapter as well.
import type { EditorView } from '@codemirror/view';
import { viewFromContentDom } from '../editor/cm6kit';
import type { EditorHandle } from '../editor/handle';
import { MAX_LISTED_DOCUMENTS, type LanguageId } from '../messaging/protocol';
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

/**
 * A site's documents as the files of its workspace, which the config's
 * `include`, `exclude` and `file_types` match, as they match a folder's
 * files in VS Code: a project's files on Overleaf and Typst, a page's place
 * in the page hierarchy on Notion. The open document's path is its
 * editor's (EditorHandle.path). A site with no such notion (Gmail, where a
 * document is a message being written) has none, and those keys do not
 * apply there.
 */
export interface SiteFiles {
    /** Every document the project holds now, workspace-relative; undefined when they cannot be read. */
    list(): Promise<readonly string[] | undefined>;
    /** What the Inspector says of the list when it is not the whole project (Notion's is the open page). */
    readonly note?: string;
}

/** Facts read in the page world, from the site's running editor. */
export interface SitePage {
    readonly id: SiteId;
    /** The editor on the page now, with the document it shows; undefined while there is none. */
    findEditor(): EditorHandle | undefined;
    /** The site's own dictionary, for a site that keeps one. */
    readonly dictionary?: () => SiteDictionarySource;
    /** The site's documents as files, for a site that has them (made in the page, as the dictionary is). */
    readonly files?: () => SiteFiles;
}

/** A segment Windows reads as a drive (`C:`, `C:notes`): no document path has one. */
const DRIVE = /^[A-Za-z]:/u;

/** The longest name a path segment made from a title keeps, in characters. */
const MAX_SEGMENT_CHARS = 200;

/**
 * `title` as one segment of a document path: a slash is a separator in a
 * path and a character in a title ("A/B tests"), so it becomes `-`, as do
 * backslashes and control characters; `.` and `..` would leave the
 * segment's place, and an empty title has no name, so both are "Untitled".
 */
export function pathSegment(title: string): string {
    // eslint-disable-next-line no-control-regex, security/detect-unsafe-regex -- control characters are what is replaced; one character class: linear
    const name = title.replaceAll(/[/\\\u{0}-\u{1F}\u{7F}-\u{9F}]/gu, '-').trim().slice(0, MAX_SEGMENT_CHARS).trim();
    if (['', '.', '..'].includes(name)) return 'Untitled';
    // `C:` starting a segment is a drive on Windows, which a path may not name (isDocumentPath).
    return DRIVE.test(name) ? `${name.slice(0, 1)}-${name.slice(2)}` : name;
}

/** How long after one read of a site's file list another may start. */
export const RELIST_MS = 5000;

/** A site's file list as last read, and the document a trail of names leads to in it. */
export interface FileListCache {
    /** Reads the list now (one read at a time); undefined when the site does not say. */
    readonly list: () => Promise<readonly string[] | undefined>;
    /**
     * `pathFromTrail` over the last list read. A path the list lacks (none
     * read yet, a file made since) has it read again, at most every
     * RELIST_MS, for the next ask: this one gets the fallback.
     */
    resolve(trail: readonly string[], fallback: string | undefined): string | undefined;
}

export function fileListCache(read: () => Promise<readonly string[] | undefined>, now: () => number = () => performance.now()): FileListCache {
    let known: ReadonlySet<string> | undefined;
    let reading: Promise<readonly string[] | undefined> | undefined;
    let readAt = -Infinity;
    const list = (): Promise<readonly string[] | undefined> => {
        readAt = now();
        reading ??= read().then((paths) => {
            // No more than a listing carries: a site's answer is not ours to bound.
            const kept = paths?.slice(0, MAX_LISTED_DOCUMENTS);
            if (kept !== undefined) known = new Set(kept);
            reading = undefined;
            return kept;
        });
        return reading;
    };
    return {
        list,
        resolve(trail, fallback) {
            const path = pathFromTrail(trail, known, fallback);
            const missing = known === undefined || (path !== undefined && !known.has(path));
            if (missing && reading === undefined && now() - readAt >= RELIST_MS) void list();
            return path;
        },
    };
}

/**
 * The document a site's trail of names leads to (its breadcrumbs, its file
 * tree's folders), as a path the project has: the longest run of names at
 * the end of `trail` that `known` holds, joined with `/`. Without one (the
 * project not read yet, or a name the list does not have), `fallback`.
 */
export function pathFromTrail(trail: readonly string[], known: ReadonlySet<string> | undefined, fallback: string | undefined): string | undefined {
    if (known !== undefined) {
        for (let from = 0; from < trail.length; from++) {
            const path = trail.slice(from).join('/');
            if (known.has(path)) return path;
        }
    }
    return fallback;
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
