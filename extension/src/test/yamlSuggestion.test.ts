import { describe, expect, it } from 'vitest';

import { declineYamlSuggestion, isYamlConfig, shouldSuggestYaml } from '../yamlSuggestion';
import type { PromptMemory } from '../packPrompt';

function memory(): PromptMemory {
    const store = new Map<string, unknown>();
    return {
        get: <T>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback),
        update: async (key: string, value: unknown) => {
            store.set(key, value);
        },
    };
}

describe('isYamlConfig', () => {
    it.each(['/w/.languagecheck.yaml', '/w/.languagecheck.yml', 'C:\\w\\.languagecheck.yaml'])(
        'matches %s',
        path => expect(isYamlConfig(path)).toBe(true),
    );

    it.each(['/w/.languagecheck.json', '/w/notes.yaml', '/w/x.languagecheck.yaml'])(
        'ignores %s',
        path => expect(isYamlConfig(path)).toBe(false),
    );
});

describe('shouldSuggestYaml', () => {
    const config = '/w/.languagecheck.yaml';

    it('suggests when the extension is missing', () => {
        expect(shouldSuggestYaml(memory(), false, false, config)).toBe(true);
    });

    it('stays quiet when the extension is installed', () => {
        expect(shouldSuggestYaml(memory(), false, true, config)).toBe(false);
    });

    it('asks at most once per session', () => {
        expect(shouldSuggestYaml(memory(), true, false, config)).toBe(false);
    });

    it('never asks again after a refusal', async () => {
        const store = memory();
        await declineYamlSuggestion(store);
        expect(shouldSuggestYaml(store, false, false, config)).toBe(false);
    });

    it('ignores other files', () => {
        expect(shouldSuggestYaml(memory(), false, false, '/w/notes.md')).toBe(false);
    });
});
