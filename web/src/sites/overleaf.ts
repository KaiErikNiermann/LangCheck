// Overleaf: one CM6 view. Its store (`window.overleaf.unstable.store`, a
// deliberate if "unstable" export) names the open document; when it is gone
// or changes shape, the DOM still finds the view and CodeMirror's own
// `data-language` still gives the language, so the store only refines.
import { isView } from '../editor/cm6kit';
import type { ForeignCheckerSpec } from '../editor/foreign';
import { cm6Editor } from '../editor/handle';
import { fileListCache, languageFromEditor, languageFromName, projectFromProjectPath, stringsIn, viewInDocument, watchRequests, type SiteDictionarySource, type SiteModule, type SitePage, type SiteWorkspace } from './site';

interface StoreItem {
    readonly value: unknown;
}
interface OverleafGlobal {
    readonly unstable?: { readonly store?: { readonly items?: { get(key: string): StoreItem | undefined } } };
}

function storeValue(key: string): unknown {
    try {
        return (globalThis as { overleaf?: OverleafGlobal }).overleaf?.unstable?.store?.items?.get(key)?.value;
    } catch {
        // A changed store shape must not take the bridge down with it.
        return undefined;
    }
}

const storeString = (key: string): string | undefined => {
    const value = storeValue(key);
    return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
};

/**
 * Overleaf's own spellchecker: mark decorations `ol-cm-spelling-error`
 * with `word: { text, from, to, lineNumber, lang }`, the project's language
 * (`en_US`). Its only UI besides the mark is the right-click menu, which
 * stays: a different gesture from our hover card.
 */
export const OVERLEAF_SPELLING: ForeignCheckerSpec = {
    checker: 'overleaf',
    rule: 'spelling',
    category: 'spelling',
    classToken: 'ol-cm-spelling-error',
    language: (spec) => (typeof spec.word === 'object' && spec.word !== null ? (spec.word as { lang?: unknown }).lang : undefined),
    hide: { '.ol-cm-spelling-error': { textDecoration: 'none' } },
};

/** How long a request to Overleaf may take before it is given up: a stalled one must not hold the sync forever. */
const SITE_REQUEST_TIMEOUT_MS = 15_000;

/** The user's learned words in a project page: a JSON array in a meta tag. */
export function learnedWordsIn(page: Document): readonly string[] | undefined {
    const content = page.querySelector('meta[name="ol-learnedWords"]')?.getAttribute('content');
    if (content === null || content === undefined) return undefined;
    try {
        return stringsIn(JSON.parse(content));
    } catch {
        return undefined;
    }
}

/**
 * Overleaf's learned words: per user, rendered into the project page as
 * `ol-learnedWords`. A word learned or unlearned after the page loaded is not
 * in that tag, so after one (an `editor:remove-learned-word` event, or a
 * request to `/spelling/learn` or `/spelling/unlearn`) the project page is
 * fetched again and the tag read from it.
 */
export function overleafDictionary(): SiteDictionarySource {
    let stale = false;
    return {
        source: 'overleaf',
        async read() {
            if (!stale) return learnedWordsIn(document);
            const response = await fetch(location.href, { signal: AbortSignal.timeout(SITE_REQUEST_TIMEOUT_MS) });
            if (!response.ok) return;
            return learnedWordsIn(new DOMParser().parseFromString(await response.text(), 'text/html'));
        },
        async add(word) {
            // Overleaf's own request: its JSON helper sends the page's CSRF token.
            const token = document.querySelector('meta[name="ol-csrfToken"]')?.getAttribute('content');
            if (!token) return 'Overleaf gave this page no token to add words with; reload it and try again.';
            const response = await fetch('/spelling/learn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token, Accept: 'application/json' },
                body: JSON.stringify({ word }),
                signal: AbortSignal.timeout(SITE_REQUEST_TIMEOUT_MS),
            });
            return response.ok ? undefined : `Overleaf did not take the word (HTTP ${String(response.status)}).`;
        },
        watch(changed) {
            const mark = (): void => {
                stale = true;
                changed();
            };
            window.addEventListener('editor:remove-learned-word', mark);
            const stop = watchRequests((url) => url.origin === location.origin && /^\/spelling\/(?:un)?learn$/u.test(url.pathname), mark);
            return () => {
                window.removeEventListener('editor:remove-learned-word', mark);
                stop();
            };
        },
    };
}

export const overleafWorkspace: SiteWorkspace = { id: 'overleaf', projectFromPath: projectFromProjectPath };

/** A project's files from `/project/<id>/entities` (`{ entities: [{ path: "/main.tex", type }] }`), without the leading slash. */
export function entityPathsIn(body: unknown): readonly string[] | undefined {
    const entities = (body as { entities?: unknown } | null)?.entities;
    if (!Array.isArray(entities)) return undefined;
    return entities.flatMap((entity: unknown) => {
        const path = (entity as { path?: unknown } | null)?.path;
        return typeof path === 'string' && path.startsWith('/') ? path.slice(1) : [];
    });
}

/**
 * The folder a tree item sits in. Overleaf draws a folder's contents as a
 * list after the folder's item, not inside it (`<li folder/><ul role=tree>
 * …</ul>`, seen 2026-10-14); a tree that nests them inside, as ARIA
 * describes, is read too.
 */
function folderOf(item: Element): Element | null {
    const inside = item.parentElement?.closest('li[role="treeitem"]');
    if (inside !== null && inside !== undefined) return inside;
    const before = item.closest('ul[role="tree"], ul[role="group"]')?.previousElementSibling;
    return before?.matches('li[role="treeitem"]') === true ? before : null;
}

/**
 * The open document's place in the file tree, folders first: the selected
 * item and the folders it sits in, which are expanded to show it. Only
 * when the selection is the open document (an image can be selected while
 * the editor still shows a document).
 */
export function trailInTree(root: Document, openName: string | undefined): readonly string[] | undefined {
    const selected = root.querySelector(':scope [role="tree"] li[role="treeitem"][aria-selected="true"]');
    const trail: string[] = [];
    for (let item = selected; item !== null; item = folderOf(item)) {
        const label = item.getAttribute('aria-label');
        if (label === null) return undefined;
        trail.unshift(label);
    }
    return trail.length > 0 && (openName === undefined || trail.at(-1) === openName) ? trail : undefined;
}

/** The project's files, or undefined when Overleaf does not say (signed out, offline, changed shape). */
async function readEntities(project: string): Promise<readonly string[] | undefined> {
    try {
        const response = await fetch(`/project/${project}/entities`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(SITE_REQUEST_TIMEOUT_MS) });
        return response.ok ? entityPathsIn(await response.json()) : undefined;
    } catch {
        return;
    }
}

/**
 * Overleaf's project as files: the paths of `/project/<id>/entities`, the
 * list Overleaf's own "files" view reads, fetched with the page's session.
 * The open document's path is its tree trail matched against the last list
 * read (a name alone where the list has not been read yet).
 */
function createOverleafPage(): SitePage {
    const files = fileListCache(async () => {
        const project = projectFromProjectPath(location.pathname);
        return project === undefined ? undefined : readEntities(project);
    });
    const path = (): string | undefined => {
        const name = storeString('editor.open_doc_name');
        const trail = trailInTree(document, name) ?? (name === undefined ? [] : [name]);
        return files.resolve(trail, trail.length > 0 ? trail.join('/') : undefined);
    };
    return {
        id: 'overleaf',
        dictionary: overleafDictionary,
        files: () => ({ list: files.list }),
        findEditor() {
            const fromStore = storeValue('editor.view');
            const view = isView(fromStore) ? fromStore : viewInDocument();
            if (view === undefined) return;
            const id = storeString('editor.open_doc_id');
            const name = storeString('editor.open_doc_name');
            return cm6Editor(
                view,
                id === undefined ? (name ?? 'document') : `${id}/${name ?? 'document'}`,
                (name === undefined ? undefined : languageFromName(name)) ?? languageFromEditor(view) ?? 'latex',
                [OVERLEAF_SPELLING],
                path,
            );
        },
    };
}

export const site: SiteModule = { workspace: overleafWorkspace, createPage: createOverleafPage };
