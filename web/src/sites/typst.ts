// Typst's web app: one CM6 view and no global state worth reading, so the
// view comes from the DOM and the document is named by its place in the
// sequence of states the view has shown (the bridge re-attaches on a file
// switch either way). Typst is the default language; `data-language` wins
// when CodeMirror reports another (a .bib file, say).
import { languageFromEditor, projectFromProjectPath, viewInDocument, type SitePage, type SiteWorkspace } from './site';

export const typstWorkspace: SiteWorkspace = { id: 'typst', projectFromPath: projectFromProjectPath };

export const typstPage: SitePage = {
    id: 'typst',
    findView: () => viewInDocument(),
    currentDocument: (view) => ({ name: 'document', languageId: languageFromEditor(view) ?? 'typst' }),
};
