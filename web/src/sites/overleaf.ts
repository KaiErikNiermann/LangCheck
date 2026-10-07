// Overleaf: one CM6 view. Its store (`window.overleaf.unstable.store`, a
// deliberate if "unstable" export) names the open document; when it is gone
// or changes shape, the DOM still finds the view and CodeMirror's own
// `data-language` still gives the language, so the store only refines.
import type { EditorView } from '@codemirror/view';
import { isView } from '../editor/cm6kit';
import { languageFromEditor, languageFromName, projectFromProjectPath, viewInDocument, type SitePage, type SiteWorkspace } from './site';

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

export const overleafWorkspace: SiteWorkspace = { id: 'overleaf', projectFromPath: projectFromProjectPath };

export const overleafPage: SitePage = {
    id: 'overleaf',
    findView(): EditorView | undefined {
        const fromStore = storeValue('editor.view');
        return isView(fromStore) ? fromStore : viewInDocument();
    },
    currentDocument(view) {
        const id = storeString('editor.open_doc_id');
        const name = storeString('editor.open_doc_name');
        return {
            name: id === undefined ? (name ?? 'document') : `${id}/${name ?? 'document'}`,
            languageId: (name === undefined ? undefined : languageFromName(name)) ?? languageFromEditor(view) ?? 'latex',
        };
    },
};
