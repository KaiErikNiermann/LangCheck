// What the bridge needs from a site's editor, whatever kind it is: who it is
// (so a swap is noticed), what document it shows, and how to join it.
import type { EditorView } from '@codemirror/view';
import type { LanguageId } from '../messaging/protocol';
import { createCm6Adapter } from './cm6Adapter';
import { discoverCm6Kit } from './cm6kit';
import type { ForeignCheckerSpec } from './foreign';
import { createDomAdapter, highlightsSupported, type DomEditorRules } from './domAdapter';
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
    /** The open document's name within the project: what tells it apart, which stays put while it is open. */
    readonly name: string;
    readonly languageId: LanguageId;
    /**
     * Where the document is in its site's project now, workspace-relative
     * (SiteFiles), for the config's file lists; asked at each check, since a
     * document can be renamed or moved while open. Absent on a site with no
     * files, undefined while it cannot be told.
     */
    readonly path?: () => string | undefined;
    attach(uri: string): AttachResult;
}

/**
 * A CodeMirror 6 view, joined through the page's own CodeMirror (Overleaf,
 * Typst), with the site's own spellcheckers in it, if it has any.
 */
export function cm6Editor(view: EditorView, name: string, languageId: LanguageId, foreign: readonly ForeignCheckerSpec[] = [], path?: () => string | undefined): EditorHandle {
    return {
        identity: view,
        name,
        languageId,
        ...(path !== undefined && { path }),
        attach(uri) {
            const discovery = discoverCm6Kit(view);
            if (!discovery.ok) return { ok: false, reason: `CodeMirror classes not found: ${discovery.missing.join(', ')}` };
            const cm6 = createCm6Adapter(view, discovery.kit, uri, languageId, foreign);
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

/** A block editor of contenteditable leaves (Notion), painted with CSS highlights. */
export function domEditor(root: Element, identity: object, name: string, languageId: LanguageId, rules: DomEditorRules, path?: () => string | undefined): EditorHandle {
    return {
        identity,
        name,
        languageId,
        ...(path !== undefined && { path }),
        attach(uri) {
            if (!highlightsSupported()) return { ok: false, reason: 'this browser has no CSS Custom Highlight API (Firefox 140+, Chrome 105+)' };
            return { ok: true, editor: createDomAdapter(root, rules, uri, languageId) };
        },
    };
}
