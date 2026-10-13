// Typst's web app: one CM6 view and no global state worth reading, so the
// view comes from the DOM and the document is named by its place in the
// sequence of states the view has shown (the bridge re-attaches on a file
// switch either way). Typst is the default language; `data-language` wins
// when CodeMirror reports another (a .bib file, say).
import { lintPayloadLanguage, type ForeignCheckerSpec } from '../editor/foreign';
import { cm6Editor } from '../editor/handle';
import { languageFromEditor, projectFromProjectPath, stringsIn, viewInDocument, watchRequests, type SiteDictionarySource, type SitePage, type SiteWorkspace } from './site';

/**
 * Typst's own spellchecker: @codemirror/lint diagnostics at hint severity
 * with `markClass: "misspelling"` and the language in `payload`. Besides
 * the mark it opens a lint tooltip on hover, as our card does; hint-level
 * entries are hidden with it (only spelling was seen at hint severity), and
 * the tooltip itself when nothing else is in it. Its gutter icon and the
 * Improve panel stay.
 */
export const TYPST_SPELLING: ForeignCheckerSpec = {
    checker: 'typst',
    rule: 'misspelling',
    category: 'spelling',
    classToken: 'misspelling',
    language: lintPayloadLanguage,
    hide: {
        '.cm-lintRange.misspelling': { backgroundImage: 'none' },
        '.cm-tooltip-lint .cm-diagnostic-hint': { display: 'none' },
        '.cm-tooltip-hover:has(.cm-diagnostic-hint):not(:has(.cm-diagnostic:not(.cm-diagnostic-hint), > :not(.cm-tooltip-lint)))': { display: 'none' },
    },
};

/** Typst's API: the one endpoint the app itself reads the user's settings from. */
const TYPST_GRAPHQL = 'https://api.typst.app/v1/graphql';

/** The personal dictionary in Typst's user settings (a JSON string in GraphQL), or undefined. */
export function personalDictionaryIn(body: unknown): readonly string[] | undefined {
    const settings = (body as { data?: { user?: { settings?: unknown } | null } } | null)?.data?.user?.settings;
    if (typeof settings !== 'string') return undefined;
    try {
        return stringsIn((JSON.parse(settings) as { personalDictionary?: unknown } | null)?.personalDictionary);
    } catch {
        return undefined;
    }
}

/**
 * Typst's personal dictionary: per user, `personalDictionary` in the user's
 * editor settings, which the app reads with `{ user { settings } }` and
 * writes with a mutation on the same endpoint. So it is read the same way,
 * and read again after the app's own requests there (a handful an hour) and
 * when the tab comes back into view; this reader's own requests are not
 * taken for the app's.
 */
export function typstDictionary(): SiteDictionarySource {
    /** When this reader's requests were in flight, so their timing entries are not taken for the app's. */
    const ours: { start: number; end: number }[] = [];
    return {
        source: 'typst',
        async read() {
            const span = { start: performance.now(), end: Infinity };
            ours.push(span);
            try {
                const response = await fetch(TYPST_GRAPHQL, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ query: '{ user { settings } }' }),
                });
                return response.ok ? personalDictionaryIn(await response.json()) : undefined;
            } finally {
                span.end = performance.now();
                if (ours.length > 20) ours.splice(0, ours.length - 20);
            }
        },
        watch(changed) {
            const stop = watchRequests(
                (url) => url.href === TYPST_GRAPHQL,
                (entry) => {
                    if (ours.every((span) => entry.startTime < span.start || entry.startTime > span.end)) changed();
                },
            );
            const visible = (): void => {
                if (document.visibilityState === 'visible') changed();
            };
            document.addEventListener('visibilitychange', visible);
            return () => {
                stop();
                document.removeEventListener('visibilitychange', visible);
            };
        },
    };
}

export const typstWorkspace: SiteWorkspace = { id: 'typst', projectFromPath: projectFromProjectPath };

export const typstPage: SitePage = {
    id: 'typst',
    dictionary: typstDictionary,
    findEditor() {
        const view = viewInDocument();
        return view === undefined ? undefined : cm6Editor(view, 'document', languageFromEditor(view) ?? 'typst', [TYPST_SPELLING]);
    },
};
