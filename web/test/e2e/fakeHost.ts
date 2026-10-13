// A stand-in for a site's editor page, close to what the live sites showed
// (research/overleaf-editor.md, typst-editor.md): one CM6 view built from
// compartments, state fields and widgets. On 127.0.0.1 it plays Overleaf
// (with `overleaf.unstable.store`), on localhost Typst (no globals). It
// bundles its own CodeMirror, twice: esbuild builds it against the current
// @codemirror/view and against 6.38 (before the 6.39 tile rewrite), so
// discovery is tested on both sides of the change that moved its internals.
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

class EndMarker extends WidgetType {
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'host-end-marker';
        span.textContent = '¶';
        return span;
    }
}

const theme = new Compartment();
const endMarker = StateField.define<DecorationSet>({
    create: (state) => Decoration.set([Decoration.widget({ widget: new EndMarker(), side: 1 }).range(state.doc.length)]),
    update: (_, tr) => Decoration.set([Decoration.widget({ widget: new EndMarker(), side: 1 }).range(tr.state.doc.length)]),
    provide: (field) => EditorView.decorations.from(field),
});
// One theme for every state: a theme built per state mounts a style module
// that is never removed (what the memory tests look for in ours).
const baseTheme = EditorView.theme({});
// ?readonly=1: a view-only collaborator's editor (both facets, as sites set them).
const readOnly = new URLSearchParams(location.search).get('readonly') === '1' ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
const overleaf = location.hostname === '127.0.0.1';
const params = new URLSearchParams(location.search);

// ?foreign=teh,parcel: the site's own spellchecker, marking those words a
// moment after each edit, as the live ones do (research/foreign-checkers.md):
// Typst's as @codemirror/lint hints with markClass "misspelling" and the
// language in `payload`, Overleaf's as `ol-cm-spelling-error` marks carrying
// `word.lang`. Between an edit and the answer, the marks are only mapped.
const flagged = new Set((params.get('foreign') ?? '').split(',').filter((w) => w !== ''));
const ANSWER_MS = 150;
let foreignAnswers = 0;
const overleafSpelling = StateEffect.define<readonly { from: number; to: number }[]>();
const overleafSpellingField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(set, tr) {
        let next = set.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(overleafSpelling)) {
                next = Decoration.set(e.value.map(({ from, to }) => Decoration.mark({ class: 'ol-cm-spelling-error', word: { text: tr.state.sliceDoc(from, to), from, to, lang: 'en_US' } }).range(from, to)));
            }
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});
/** Overleaf's own rule for its marks, as measured on the live site. */
const overleafSpellingTheme = EditorView.baseTheme({ '.ol-cm-spelling-error': { textDecoration: 'underline 2px dotted red' } });
let answerTimer: ReturnType<typeof setTimeout> | undefined;
function answerSpelling(view: EditorView): void {
    const text = view.state.doc.toString();
    const found = [...text.matchAll(/\p{L}+/gu)].filter((m) => flagged.has(m[0])).map((m) => ({ from: m.index, to: m.index + m[0].length }));
    foreignAnswers++;
    if (overleaf) {
        view.dispatch({ effects: overleafSpelling.of(found) });
        return;
    }
    const diagnostics: Diagnostic[] = found.map(({ from, to }) => ({ from, to, severity: 'hint', markClass: 'misspelling', message: `the word "${text.slice(from, to)}" seems to be misspelled`, payload: 'en' }) as Diagnostic);
    view.dispatch(setDiagnostics(view.state, diagnostics));
}
const scheduleAnswer = (view: EditorView): void => {
    clearTimeout(answerTimer);
    answerTimer = setTimeout(() => {
        answerSpelling(view);
    }, ANSWER_MS);
};
const siteSpelling: Extension =
    flagged.size === 0
        ? []
        : [
              overleaf ? [overleafSpellingField, overleafSpellingTheme] : [],
              EditorView.updateListener.of((update: ViewUpdate) => {
                  if (update.docChanged) scheduleAnswer(update.view);
              }),
          ];

const hostExtensions = (): Extension => [theme.of(baseTheme), endMarker, EditorView.lineWrapping, readOnly, siteSpelling];
const initial = params.get('text') ?? 'I will recieve teh parcel tomorrow.\nTeh end.';
const items = new Map<string, { value: unknown }>();
const setItem = (key: string, value: unknown): void => {
    items.set(key, { value });
};

const parent = document.querySelector('#editor') ?? document.body;
let view = new EditorView({ state: EditorState.create({ doc: initial, extensions: hostExtensions() }), parent });
if (flagged.size > 0) scheduleAnswer(view);
if (overleaf) {
    setItem('editor.view', view);
    setItem('editor.open_doc_id', 'doc-main');
    setItem('editor.open_doc_name', params.get('name') ?? 'main.tex');
    Object.assign(globalThis, { overleaf: { unstable: { store: { items: { get: (key: string) => items.get(key) } } } } });
}

Object.assign(globalThis, {
    __host: {
        get view() {
            return view;
        },
        text: () => view.state.doc.toString(),
        /** How many times the site's own spellchecker has answered (`?foreign=`). */
        foreignAnswers: () => foreignAnswers,
        /** A file switch: same view, fresh state (both sites do this). */
        switchFile(id: string, name: string, text: string) {
            setItem('editor.open_doc_id', id);
            setItem('editor.open_doc_name', name);
            view.setState(EditorState.create({ doc: text, extensions: hostExtensions() }));
            if (flagged.size > 0) scheduleAnswer(view);
        },
        /** A settings change: reconfigures one of the host's compartments. */
        reconfigure() {
            view.dispatch({ effects: theme.reconfigure(EditorView.theme({ '&': { fontSize: '15px' } })) });
        },
        /** A remount: a new view replaces the old one. */
        remount(text: string) {
            view.destroy();
            view = new EditorView({ state: EditorState.create({ doc: text, extensions: hostExtensions() }), parent });
            if (flagged.size > 0) scheduleAnswer(view);
            if (overleaf) setItem('editor.view', view);
        },
        /** A collaborator's edit arriving over the wire. */
        remoteInsert(at: number, text: string) {
            view.dispatch({ changes: { from: at, insert: text }, userEvent: 'remote' });
        },
        /** Overleaf's "Add to dictionary": the request its editor makes (the stand-in server keeps the word). */
        async learn(word: string) {
            const project = location.pathname.split('/', 3)[2] ?? '';
            await fetch('/spelling/learn', { method: 'POST', body: JSON.stringify({ word, project }) });
        },
        /** Typst saving its settings: a request to its API, as the app makes one (the test answers it). */
        async typstSettingsSaved() {
            await fetch('https://api.typst.app/v1/graphql', { method: 'POST', body: '{"query":"mutation EditUser { x }"}' });
        },
        /** The user typing at the end of the document. */
        typeAtEnd(text: string) {
            view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: 'input.type' });
        },
    },
});
