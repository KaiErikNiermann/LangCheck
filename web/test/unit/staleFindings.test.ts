// Findings checked against older text are neither drawn nor offered: their
// ranges are in that text, and converted against the current one they mark
// the wrong characters and a fix edits there.
import { afterEach, expect, test } from 'vitest';
import type { ActionSource, EditorAdapter, RenderedDiagnostic } from '../../src/editor/types';
import { Diagnostic, DiagnosticSeverity, host, languages, Position, Range, type TextDocument } from '../../src/shim/vscode';

/** An editor holding "a teh b" under `uri`, that can be typed into. */
function fakeEditor(uri: string) {
    let text = 'a teh b';
    const changed: (() => void)[] = [];
    const drawn: (readonly RenderedDiagnostic[])[] = [];
    let actions: ActionSource | undefined;
    const adapter = {
        uri,
        languageId: 'markdown',
        getText: () => text,
        onDidChange: (listener: () => void) => {
            changed.push(listener);
        },
        renderDiagnostics: (diagnostics: readonly RenderedDiagnostic[]) => {
            drawn.push(diagnostics);
        },
        renderHints: () => {},
        applyEdits: () => true,
        setActionSource: (source: ActionSource) => {
            actions = source;
        },
        setHoverSource: () => {},
        notify: () => {},
        select: () => {},
    } satisfies EditorAdapter;
    return {
        adapter,
        drawn,
        actions: (from: number, to: number) => actions?.(from, to) ?? Promise.resolve([]),
        type: (at: number, inserted: string) => {
            text = text.slice(0, at) + inserted + text.slice(at);
            for (const listener of changed) listener();
        },
    };
}

afterEach(() => {
    host.findingsCurrent = undefined;
});

test('a list checked against older text is not drawn, and no action is offered from it', async () => {
    const editor = fakeEditor('test:/stale.md');
    const doc: TextDocument = host.open(editor.adapter);
    const checkedAt = doc.version;
    // The client's store: current only at the version the check was of.
    host.findingsCurrent = (d) => d.version === checkedAt;
    languages.registerCodeActionsProvider({ language: 'markdown' }, {
        provideCodeActions: (_d, _r, context) => context.diagnostics.map(() => ({ title: 'Fix: the', edit: undefined })) as never,
    });
    const collection = languages.createDiagnosticCollection('test');
    // The user types before the finding while the check is out.
    editor.type(0, 'X');
    // The check of "a teh b" comes back: "teh" at 2..5 in that text.
    collection.set(doc.uri, [new Diagnostic(new Range(new Position(0, 2), new Position(0, 5)), 'Did you mean the?', DiagnosticSeverity.Warning)]);
    expect(editor.drawn.flat()).toEqual([]);
    // Over "Xa " + "te": where the stale range would now point.
    expect(await editor.actions(2, 5)).toEqual([]);
    collection.dispose();
});

test('a list of the current text is drawn and offered', async () => {
    const editor = fakeEditor('test:/current.md');
    const doc: TextDocument = host.open(editor.adapter);
    host.findingsCurrent = (d) => d.version === doc.version;
    languages.registerCodeActionsProvider({ language: 'markdown' }, {
        provideCodeActions: (_d, _r, context) => context.diagnostics.map(() => ({ title: 'Fix: the', edit: undefined })) as never,
    });
    const collection = languages.createDiagnosticCollection('test');
    collection.set(doc.uri, [new Diagnostic(new Range(new Position(0, 2), new Position(0, 5)), 'Did you mean the?', DiagnosticSeverity.Warning)]);
    expect(editor.drawn.at(-1)?.map((d) => [d.from, d.to])).toEqual([[2, 5]]);
    expect(await editor.actions(2, 5)).not.toEqual([]);
    collection.dispose();
});
