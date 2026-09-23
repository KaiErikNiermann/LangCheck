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
