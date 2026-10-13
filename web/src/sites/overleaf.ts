// Overleaf: one CM6 view. Its store (`window.overleaf.unstable.store`, a
// deliberate if "unstable" export) names the open document; when it is gone
// or changes shape, the DOM still finds the view and CodeMirror's own
// `data-language` still gives the language, so the store only refines.
import { isView } from '../editor/cm6kit';
import type { ForeignCheckerSpec } from '../editor/foreign';
import { cm6Editor } from '../editor/handle';
import { languageFromEditor, languageFromName, projectFromProjectPath, stringsIn, viewInDocument, watchRequests, type SiteDictionarySource, type SiteModule, type SitePage, type SiteWorkspace } from './site';

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

export const overleafPage: SitePage = {
    id: 'overleaf',
    dictionary: overleafDictionary,
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
        );
    },
};

export const site: SiteModule = { workspace: overleafWorkspace, createPage: () => overleafPage };
