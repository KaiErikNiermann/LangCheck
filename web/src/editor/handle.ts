// What the bridge needs from a site's editor, whatever kind it is: who it is
// (so a swap is noticed), what document it shows, and how to join it.
import type { EditorView } from '@codemirror/view';
import type { LanguageId } from '../messaging/protocol';
import { createCm6Adapter } from './cm6Adapter';
import { discoverCm6Kit } from './cm6kit';
import type { EditorAdapter } from './types';

export interface AttachedEditor {
    readonly adapter: EditorAdapter;
    /** Whether the editor still carries what we installed (a site may drop it). */
    isInstalled(): boolean;
    /** Leaves the editor as it was found. */
    dispose(): void;
}

export type AttachResult = { readonly ok: true; readonly editor: AttachedEditor } | { readonly ok: false; readonly reason: string };

export interface EditorHandle {
    /** Compared with `===`: a different object means a different editor. */
    readonly identity: object;
    /** The open document's name within the project. */
    readonly name: string;
    readonly languageId: LanguageId;
    attach(uri: string): AttachResult;
}

/** A CodeMirror 6 view, joined through the page's own CodeMirror (Overleaf, Typst). */
export function cm6Editor(view: EditorView, name: string, languageId: LanguageId): EditorHandle {
    return {
        identity: view,
        name,
        languageId,
        attach(uri) {
            const discovery = discoverCm6Kit(view);
            if (!discovery.ok) return { ok: false, reason: `CodeMirror classes not found: ${discovery.missing.join(', ')}` };
            const cm6 = createCm6Adapter(view, discovery.kit, uri, languageId);
            view.dispatch({ effects: discovery.kit.StateEffect.appendConfig.of(cm6.extension) });
            // Verified by behaviour, not assumed: if the page's editor did not
            // take the extension, say so instead of acting attached.
            if (!cm6.isInstalled()) {
                cm6.dispose();
                return { ok: false, reason: 'the editor did not accept the extension' };
            }
            return { ok: true, editor: cm6 };
        },
    };
}
