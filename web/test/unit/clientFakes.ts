// Fakes for running the client's finding actions on the shim: an editor
// that applies edits as the real adapters do, a store, and the actions.
import { afterEach, vi } from 'vitest';
import { DiagnosticActions, type DiagnosticActionDeps } from '../../../extension/src/diagnostics/actions';
import { DiagnosticStore } from '../../../extension/src/diagnostics/store';
import { InspectorLog } from '../../../extension/src/ui/inspectorLog';
import { editsHold } from '../../src/editor/edits';
import type { EditorAdapter, TextEdit } from '../../src/editor/types';
import { Diagnostic, DiagnosticSeverity, host, Range, window, type TextDocument } from '../../src/shim/vscode';

/** An editor over `initial` that applies edits as the real adapters do: only when they hold. */
export function fakeEditor(uri: string, initial: string, during?: () => void) {
    let text = initial;
    const changed: (() => void)[] = [];
    const editor = {
        refuse: false,
        /** Made to the text in the same step as an edit: an editor applying it its own way, or the page reacting. */
        alsoChange: undefined as ((text: string) => string) | undefined,
        adapter: {
            uri,
            languageId: 'markdown',
            getText: () => text,
            onDidChange: (listener: () => void) => {
                changed.push(listener);
            },
            renderDiagnostics: () => {},
            renderHints: () => {},
            applyEdits: (edits: readonly TextEdit[]) => {
                during?.();
                if (editor.refuse || !editsHold(edits, text.length, (from, to) => text.slice(from, to))) return false;
                // From the end, so each edit's offsets are still those of the text it was made for.
                const fromTheEnd = edits.toSorted((a, b) => b.from - a.from);
                for (const e of fromTheEnd) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
                if (editor.alsoChange !== undefined) text = editor.alsoChange(text);
                for (const listener of changed) listener();
                return true;
            },
            setActionSource: () => {},
            setHoverSource: () => {},
            notify: () => {},
            select: () => {},
        } satisfies EditorAdapter,
        text: () => text,
        type: (at: number, inserted: string) => {
            text = text.slice(0, at) + inserted + text.slice(at);
            for (const listener of changed) listener();
        },
    };
    return editor;
}

export const finding = (doc: TextDocument, from: number, to: number, code: string): Diagnostic => {
    const d = new Diagnostic(new Range(doc.positionAt(from), doc.positionAt(to)), 'x', DiagnosticSeverity.Warning);
    d.code = code;
    return d;
};

export function setup() {
    const store = new DiagnosticStore();
    const inspectorLog = new InspectorLog();
    const check = vi.fn(() => Promise.resolve(0));
    const actions = new DiagnosticActions({
        core: {} as DiagnosticActionDeps['core'],
        checker: { check } as unknown as DiagnosticActionDeps['checker'],
        log: { debug: () => {} },
        inspectorLog,
        store,
        fixTarget: { findEditor: () => window.activeTextEditor } as DiagnosticActionDeps['fixTarget'],
        speedFix: { sendLoading: () => {}, reveal: () => {} },
    });
    return { store, check, actions, inspectorLog };
}

const opened: TextDocument[] = [];
export const open = (editor: ReturnType<typeof fakeEditor>): TextDocument => {
    const doc = host.open(editor.adapter);
    opened.push(doc);
    return doc;
};
// Each test file that imports this closes what it opened.
afterEach(() => {
    for (const doc of opened.splice(0)) host.close(doc);
});
