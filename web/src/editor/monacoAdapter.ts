// The config page's editor: Monaco, behind the same contract as the site
// editors, so the client's ConfigStatusView draws into it through the shim
// as it draws into VS Code. Findings are Monaco markers (its squiggles);
// decoration types with a gutter icon are glyph-margin decorations with a
// hover, which is VS Code's gutter. Edits are compare-and-swap, as in every
// adapter (TextEdit.expected).
import { editsHold } from './edits';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import type { EditorAdapter, RenderedDecoration, RenderedDecorationType, RenderedDiagnostic, TextEdit } from './types';

/** The owner the markers are set under. */
const MARKER_OWNER = 'language-check';

export interface MonacoAdapter extends EditorAdapter {
    dispose(): void;
}

export function createMonacoAdapter(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor, uri: string, languageId: string, notify: (message: string) => void): MonacoAdapter {
    const model = editor.getModel();
    if (model === null) throw new Error('the editor has no model');
    /** Monaco's marker severity, in `vscode.DiagnosticSeverity` order: Error, Warning, Information, Hint. */
    const severity = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint] as const;
    const changeListeners: (() => void)[] = [];
    const subscription = model.onDidChangeContent(() => {
        for (const listener of changeListeners) listener();
    });
    /** Each decoration type's drawn marks, by key. */
    const collections = new Map<string, Monaco.editor.IEditorDecorationsCollection>();
    /** One CSS class per gutter icon, made once. */
    const iconClasses = new Map<string, string>();
    const style = document.createElement('style');
    document.head.append(style);

    const range = (from: number, to: number): Monaco.IRange => {
        const start = model.getPositionAt(from);
        const end = model.getPositionAt(to);
        return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    };

    const iconClass = (icon: string): string => {
        let name = iconClasses.get(icon);
        if (name === undefined) {
            name = `lc-gutter-${String(iconClasses.size + 1)}`;
            iconClasses.set(icon, name);
            // The icon URL is the extension's own (a media file it ships); CSS.escape keeps it a string.
            style.textContent += `.${name} { background: url("${CSS.escape(icon)}") center / contain no-repeat; }\n`;
        }
        return name;
    };

    return {
        uri,
        languageId,
        getText: () => model.getValue(),
        onDidChange: (listener) => {
            changeListeners.push(listener);
        },
        renderDiagnostics: (diagnostics: readonly RenderedDiagnostic[]) => {
            monaco.editor.setModelMarkers(
                model,
                MARKER_OWNER,
                diagnostics.map((d) => ({ ...range(d.from, d.to), severity: severity[d.severity], message: d.message, source: d.source ?? '' })),
            );
        },
        renderHints: () => {},
        renderDecorations: (type: RenderedDecorationType, marks: readonly RenderedDecoration[]) => {
            const decorations = marks.map((mark) => ({
                range: range(mark.from, mark.to),
                options: {
                    ...(type.gutterIcon !== undefined && { glyphMarginClassName: iconClass(type.gutterIcon) }),
                    ...(mark.hover !== undefined && { glyphMarginHoverMessage: { value: mark.hover, isTrusted: false } }),
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            }));
            const collection = collections.get(type.key);
            if (collection === undefined) collections.set(type.key, editor.createDecorationsCollection(decorations));
            else collection.set(decorations);
        },
        applyEdits: (edits: readonly TextEdit[]) => {
            const text = model.getValue();
            if (!editsHold(edits, text.length, (from, to) => text.slice(from, to))) return false;
            model.pushEditOperations([], edits.map((e) => ({ range: range(e.from, e.to), text: e.insert })), () => null);
            return true;
        },
        setActionSource: () => {},
        setHoverSource: () => {},
        notify,
        select: (from, to) => {
            const selection = range(from, to);
            editor.setSelection(selection);
            editor.revealRangeInCenter(selection);
        },
        dispose: () => {
            subscription.dispose();
            for (const collection of collections.values()) collection.clear();
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
            style.remove();
        },
    };
}
