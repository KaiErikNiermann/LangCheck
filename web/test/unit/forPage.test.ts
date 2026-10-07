// A config listing reaches a web page without the files the native host's
// workspace holds, and without the parser's words, which quote values.
import { expect, test } from 'vitest';
import { CONFIG_UNREADABLE, forPage } from '../../src/background/forPage';

const listing = (fields: Record<string, unknown>) => ({ id: 3, ok: true as const, response: { listConfigFiles: { configPath: '.languagecheck.yaml', include: ['**/*.md'], ...fields } } });

test('the parser\'s words on an unreadable config are replaced: they can quote an API key', () => {
    const shown = forPage(listing({ loadError: 'engines.languagetool.apiKey: invalid type: string "sk-live-123", expected a map', selected: ['dictionary.txt'], skipped: [{ path: 'index.db' }] }));
    expect(shown).toEqual(listing({ loadError: CONFIG_UNREADABLE, selected: [], skipped: [] }));
    expect(JSON.stringify(shown)).not.toContain('sk-live-123');
});

test('a readable config keeps its name and its includes', () => {
    expect(forPage(listing({ loadError: '', selected: ['a.md'] }))).toEqual(listing({ loadError: '', selected: [], skipped: [] }));
});

test('other answers pass as they are', () => {
    const check = { id: 4, ok: true as const, response: { checkProse: { diagnostics: [] } } };
    expect(forPage(check)).toBe(check);
    const failed = { id: 5, ok: false as const, code: 'failed' as const, error: 'x' };
    expect(forPage(failed)).toBe(failed);
});
