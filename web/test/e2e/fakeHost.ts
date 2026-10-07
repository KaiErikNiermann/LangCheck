// A stand-in for a site's editor page, close to what the live sites showed
// (research/overleaf-editor.md, typst-editor.md): one CM6 view built from
// compartments, state fields and widgets. On 127.0.0.1 it plays Overleaf
// (with `overleaf.unstable.store`), on localhost Typst (no globals). It
// bundles its own CodeMirror, twice: esbuild builds it against the current
// @codemirror/view and against 6.38 (before the 6.39 tile rewrite), so
// discovery is tested on both sides of the change that moved its internals.
import { Compartment, EditorState, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

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
const hostExtensions = (): Extension => [theme.of(EditorView.theme({})), endMarker, EditorView.lineWrapping];

const overleaf = location.hostname === '127.0.0.1';
const params = new URLSearchParams(location.search);
const initial = params.get('text') ?? 'I will recieve teh parcel tomorrow.\nTeh end.';
const items = new Map<string, { value: unknown }>();
const setItem = (key: string, value: unknown): void => {
    items.set(key, { value });
};

const parent = document.querySelector('#editor') ?? document.body;
let view = new EditorView({ state: EditorState.create({ doc: initial, extensions: hostExtensions() }), parent });
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
        /** A file switch: same view, fresh state (both sites do this). */
        switchFile(id: string, name: string, text: string) {
            setItem('editor.open_doc_id', id);
            setItem('editor.open_doc_name', name);
            view.setState(EditorState.create({ doc: text, extensions: hostExtensions() }));
        },
        /** A settings change: reconfigures one of the host's compartments. */
        reconfigure() {
            view.dispatch({ effects: theme.reconfigure(EditorView.theme({ '&': { fontSize: '15px' } })) });
        },
        /** A remount: a new view replaces the old one. */
        remount(text: string) {
            view.destroy();
            view = new EditorView({ state: EditorState.create({ doc: text, extensions: hostExtensions() }), parent });
            if (overleaf) setItem('editor.view', view);
        },
        /** A collaborator's edit arriving over the wire. */
        remoteInsert(at: number, text: string) {
            view.dispatch({ changes: { from: at, insert: text }, userEvent: 'remote' });
        },
        /** The user typing at the end of the document. */
        typeAtEnd(text: string) {
            view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: 'input.type' });
        },
    },
});
