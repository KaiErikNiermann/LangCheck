// Typst's web app: one CM6 view and no global state worth reading, so the
// view comes from the DOM and the document is named by its place in the
// sequence of states the view has shown (the bridge re-attaches on a file
// switch either way). Typst is the default language; `data-language` wins
// when CodeMirror reports another (a .bib file, say).
import { lintPayloadLanguage, type ForeignCheckerSpec } from '../editor/foreign';
import { cm6Editor } from '../editor/handle';
import { fileListCache, languageFromEditor, projectFromProjectPath, stringsIn, viewInDocument, watchRequests, type SiteDictionarySource, type SiteModule, type SitePage, type SiteWorkspace } from './site';

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

/** How long a request to Typst's API may take before it is given up. */
const SITE_REQUEST_TIMEOUT_MS = 15_000;

/** The most words Typst keeps in a personal dictionary (its MAX_PERSONAL_DICTIONARY_SIZE). */
const TYPST_DICTIONARY_CAP = 100;

type Settings = Record<string, unknown>;

/** Typst's user settings from a `{ user { settings } }` answer (a JSON string there), or undefined. */
function settingsIn(body: unknown): Settings | undefined {
    const settings = (body as { data?: { user?: { settings?: unknown } | null } } | null)?.data?.user?.settings;
    if (typeof settings !== 'string') return undefined;
    try {
        const parsed: unknown = JSON.parse(settings);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Settings) : undefined;
    } catch {
        return undefined;
    }
}

/** The personal dictionary in Typst's user settings (a JSON string in GraphQL), or undefined. */
export function personalDictionaryIn(body: unknown): readonly string[] | undefined {
    return stringsIn(settingsIn(body)?.personalDictionary);
}

/** Typst's API as this extension asks it, telling its own requests from the app's. */
export interface TypstApi {
    /** Posts `body` to the API with the page's session: the answer's JSON, or undefined. */
    ask(body: unknown): Promise<unknown>;
    /** Whether a request the page made was one of `ask`'s (by when it started). */
    isOurs(entry: PerformanceEntry): boolean;
}

export function typstApi(): TypstApi {
    /** When this extension's requests were in flight, so their timing entries are not taken for the app's. */
    const ours: { start: number; end: number }[] = [];
    return {
        async ask(body) {
            const span = { start: performance.now(), end: Infinity };
            ours.push(span);
            try {
                const response = await fetch(TYPST_GRAPHQL, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                    // A stalled request must not hold the sync (or an add) forever.
                    signal: AbortSignal.timeout(SITE_REQUEST_TIMEOUT_MS),
                });
                return response.ok ? ((await response.json()) as unknown) : undefined;
            } finally {
                span.end = performance.now();
                if (ours.length > 20) ours.splice(0, ours.length - 20);
            }
        },
        isOurs: (entry) => ours.some((span) => entry.startTime >= span.start && entry.startTime <= span.end),
    };
}

/**
 * Typst's personal dictionary: per user, `personalDictionary` in the user's
 * editor settings, which the app reads with `{ user { settings } }` and
 * writes whole with `updateUser(settings:)` on the same endpoint. So it is
 * read and written the same way: a write reads the settings fresh and changes
 * that one field. It is read again after the app's own requests there (a
 * handful an hour) and when the tab comes back into view; this reader's own
 * requests are not taken for the app's.
 *
 * The open Typst tab keeps its own copy of the settings, and writes all of
 * them on its next settings change: a word added here before that tab reloads
 * can be written away again by it.
 */
export function typstDictionary(api: TypstApi = typstApi()): SiteDictionarySource {
    const ask = (body: unknown): Promise<unknown> => api.ask(body);
    const readSettings = async (): Promise<Settings | undefined> => settingsIn(await ask({ query: '{ user { settings } }' }));
    return {
        source: 'typst',
        async read() {
            const settings = await readSettings();
            return stringsIn(settings?.personalDictionary);
        },
        async add(word) {
            const settings = await readSettings();
            if (settings === undefined) return "Typst's settings could not be read; is this tab signed in?";
            const words = stringsIn(settings.personalDictionary) ?? [];
            const present = words.some((w) => w.toLowerCase() === word.toLowerCase());
            if (!present && words.length >= TYPST_DICTIONARY_CAP) return `Typst's personal dictionary is full (${String(TYPST_DICTIONARY_CAP)} words); remove some in Typst's settings first.`;
            if (present) return;
            const answer = (await ask({
                query: 'mutation AddWord($settings: String) { updateUser(settings: $settings) { id } }',
                variables: { settings: JSON.stringify({ ...settings, personalDictionary: [...words, word] }) },
            })) as { data?: unknown; errors?: unknown } | undefined;
            return answer?.data !== undefined && answer.errors === undefined ? undefined : 'Typst did not take the word.';
        },
        watch(changed) {
            const stop = watchRequests(
                (url) => url.href === TYPST_GRAPHQL,
                (entry) => {
                    if (!api.isOurs(entry)) changed();
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

/** A project's file paths from `{ project { files { name } } }`: a file's name is its path (`chapters/intro.typ`). */
export function projectFilesIn(body: unknown): readonly string[] | undefined {
    const files = (body as { data?: { project?: { files?: unknown } | null } } | null)?.data?.project?.files;
    return Array.isArray(files) ? files.flatMap((file: unknown) => {
        const name = (file as { name?: unknown } | null)?.name;
        return typeof name === 'string' ? name : [];
    }) : undefined;
}

/**
 * The names in the editor's header: owner, project, then the open file's
 * folders and the file itself (`… / test / chapters / intro.typ`).
 */
export function headerTrail(root: Document): readonly string[] {
    const heading = root.querySelector(':scope header [role="heading"]');
    return heading === null ? [] : [...heading.children].map((crumb) => crumb.textContent.trim()).filter((name) => name !== '');
}

/** The project's file paths, or undefined when Typst does not say (signed out, offline, changed shape). */
async function readProjectFiles(api: TypstApi, project: string): Promise<readonly string[] | undefined> {
    try {
        // The id is a URL-safe token (projectFromProjectPath): nothing to escape.
        return projectFilesIn(await api.ask({ query: `{ project(id: "${project}") { files { name } } }` }));
    } catch {
        return;
    }
}

/** Crumbs before the file's folders: the owner and the project. */
const PROJECT_CRUMBS = 2;

/**
 * Typst's project as files: the names of `{ project { files { name } } }`
 * on the API the app itself reads. The open file's path is the header's
 * crumbs matched against the last list read; before one is read, the
 * crumbs past the owner and project.
 */
function createTypstPage(): SitePage {
    // One for both: the dictionary's watch must not take the file list's requests for the app's.
    const api = typstApi();
    const files = fileListCache(async () => {
        const project = projectFromProjectPath(location.pathname);
        return project === undefined ? undefined : readProjectFiles(api, project);
    });
    const path = (): string | undefined => {
        const trail = headerTrail(document);
        const own = trail.slice(PROJECT_CRUMBS);
        return files.resolve(trail, own.length > 0 ? own.join('/') : undefined);
    };
    return {
        id: 'typst',
        dictionary: () => typstDictionary(api),
        files: () => ({ list: files.list }),
        findEditor() {
            const view = viewInDocument();
            return view === undefined ? undefined : cm6Editor(view, 'document', languageFromEditor(view) ?? 'typst', [TYPST_SPELLING], path);
        },
    };
}

export const site: SiteModule = { workspace: typstWorkspace, createPage: createTypstPage };
