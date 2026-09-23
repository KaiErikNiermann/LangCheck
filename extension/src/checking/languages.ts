import * as path from 'path';
import type * as vscode from 'vscode';

/**
 * Canonical language IDs with built-in tree-sitter support, plus known VS Code
 * language ID aliases that map to a canonical ID.
 */
export const SUPPORTED_LANGUAGES: readonly string[] = [
    'markdown', 'html', 'latex', 'forester', 'tinylang', 'rst', 'sweave', 'bibtex', 'org', 'typst', 'mdx', 'xhtml',
];

/** The document selector the providers register for. A fresh array each call, as registration takes one. */
export function supportedLanguageSelector(): { language: string }[] {
    return SUPPORTED_LANGUAGES.map(lang => ({ language: lang }));
}

/**
 * Whether this extension should check a document.
 *
 * Two ways to qualify. VS Code's language id, for the formats there are
 * grammars for -- and the file's extension, for the ones only an SLS
 * schema handles. A schema language has no language id in VS Code, so
 * checking the id alone made every schema unreachable from the editor
 * however correct it was: the core would have used it, and was never
 * asked.
 */
export function isCheckableIn(document: vscode.TextDocument, schemaExtensions: ReadonlySet<string>): boolean {
    if (SUPPORTED_LANGUAGES.includes(document.languageId)) return true;
    const extension = path.extname(document.fileName).replace(/^\./, '').toLowerCase();
    return extension.length > 0 && schemaExtensions.has(extension);
}
