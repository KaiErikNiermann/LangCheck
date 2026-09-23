import { describe, expect, it } from 'vitest';

import {
    addLatexListEntry,
    deactivateRule,
    engineEnabled,
    setEngineEnabled,
    setSpellLanguage,
    spellLanguageOf,
} from '../config/edits';

describe('addLatexListEntry', () => {
    it('prepends the whole block to a file with none of it', () => {
        expect(addLatexListEntry('engines:\n  harper: true\n', 'skip_environments', 'sidenote')).toBe(
            'languages:\n  latex:\n    skip_environments:\n      - sidenote\nengines:\n  harper: true\n',
        );
    });

    it('goes under an existing latex: block', () => {
        expect(addLatexListEntry('languages:\n  latex:\n    skip_environments:\n      - a\n', 'prose_environments', 'b'))
            .toBe('languages:\n  latex:\n    prose_environments:\n      - b\n    skip_environments:\n      - a\n');
    });

    it('goes under languages: when latex: is missing', () => {
        expect(addLatexListEntry('languages:\n  markdown: {}\n', 'skip_commands', 'annotate'))
            .toBe('languages:\n  latex:\n    skip_commands:\n      - annotate\n  markdown: {}\n');
    });

    it('appends to the list when it already exists', () => {
        expect(addLatexListEntry('languages:\n  latex:\n    skip_commands:\n      - a\n', 'skip_commands', 'b'))
            .toBe('languages:\n  latex:\n    skip_commands:\n      - b\n      - a\n');
    });
});

describe('spellLanguageOf', () => {
    it('reads the value', () => {
        expect(spellLanguageOf('engines:\n  spell_language: de-DE\n')).toBe('de-DE');
    });

    it('defaults to en-US', () => {
        expect(spellLanguageOf('engines:\n  harper: true\n')).toBe('en-US');
    });
});

describe('setSpellLanguage', () => {
    it('replaces an existing value', () => {
        expect(setSpellLanguage('engines:\n  spell_language: en-US\n', 'en-GB')).toBe('engines:\n  spell_language: en-GB\n');
    });

    it('adds the key under engines:', () => {
        expect(setSpellLanguage('engines:\n  harper: true\n', 'en-GB'))
            .toBe('engines:\n  spell_language: en-GB\n  harper: true\n');
    });

    it('prepends engines: when there is none', () => {
        expect(setSpellLanguage('rules: {}\n', 'fr')).toBe('engines:\n  spell_language: fr\nrules: {}\n');
    });
});

describe('engineEnabled', () => {
    it('reads the shorthand', () => {
        expect(engineEnabled('engines:\n  vale: true\n', 'vale', false)).toBe(true);
        expect(engineEnabled('engines:\n  harper: false\n', 'harper', true)).toBe(false);
    });

    it('prefers the nested spelling', () => {
        expect(engineEnabled('engines:\n  vale:\n    enabled: true\n', 'vale', false)).toBe(true);
    });

    it('falls back when the engine is not mentioned', () => {
        expect(engineEnabled('engines: {}\n', 'harper', true)).toBe(true);
        expect(engineEnabled('', 'vale', false)).toBe(false);
    });
});

describe('setEngineEnabled', () => {
    it('rewrites the nested spelling in place', () => {
        expect(setEngineEnabled('engines:\n  vale:\n    enabled: false\n', 'vale', true))
            .toBe('engines:\n  vale:\n    enabled: true\n');
    });

    it('rewrites the shorthand in place', () => {
        expect(setEngineEnabled('engines:\n  harper: true\n', 'harper', false)).toBe('engines:\n  harper: false\n');
    });

    it('adds new engines under engines:, so a pass lands them in reverse', () => {
        let content = '# header\nengines:\n  harper: true\n';
        for (const [key, on] of [['harper', true], ['languagetool', false], ['vale', false], ['proselint', false]] as const) {
            content = setEngineEnabled(content, key, on);
        }
        expect(content).toBe(
            '# header\nengines:\n  proselint: false\n  vale: false\n  languagetool: false\n  harper: true\n',
        );
    });

    it('prepends engines: when there is none', () => {
        expect(setEngineEnabled('', 'vale', true)).toBe('engines:\n  vale: true\n');
    });
});

describe('deactivateRule', () => {
    it('adds a rules: block at the end of a file without one', () => {
        expect(deactivateRule('engines:\n  harper: true\n', 'harper.Spelling')).toEqual({
            content: 'engines:\n  harper: true\n\nrules:\n  harper.Spelling:\n    severity: "off"\n',
            alreadyDeactivated: false,
        });
    });

    it('adds the rule under an existing rules:', () => {
        expect(deactivateRule('rules:\n  other:\n    severity: "off"\n', 'x.Y').content)
            .toBe('rules:\n  x.Y:\n    severity: "off"\n  other:\n    severity: "off"\n');
    });

    it('leaves the file alone when the rule already has an entry', () => {
        const content = 'rules:\n  harper.Spelling:\n    severity: "off"\n';
        expect(deactivateRule(content, 'harper.Spelling')).toEqual({ content, alreadyDeactivated: true });
    });

    it('treats regex metacharacters in the rule id literally', () => {
        expect(deactivateRule('rules:\n  aXb:\n', 'a.b').alreadyDeactivated).toBe(false);
    });
});
