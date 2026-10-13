// Typst's web app: one CM6 view and no global state worth reading, so the
// view comes from the DOM and the document is named by its place in the
// sequence of states the view has shown (the bridge re-attaches on a file
// switch either way). Typst is the default language; `data-language` wins
// when CodeMirror reports another (a .bib file, say).
import { lintPayloadLanguage, type ForeignCheckerSpec } from '../editor/foreign';
import { cm6Editor } from '../editor/handle';
import { languageFromEditor, projectFromProjectPath, viewInDocument, type SitePage, type SiteWorkspace } from './site';

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

export const typstWorkspace: SiteWorkspace = { id: 'typst', projectFromPath: projectFromProjectPath };

export const typstPage: SitePage = {
    id: 'typst',
    findEditor() {
        const view = viewInDocument();
        return view === undefined ? undefined : cm6Editor(view, 'document', languageFromEditor(view) ?? 'typst', [TYPST_SPELLING]);
    },
};
