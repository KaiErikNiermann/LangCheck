import { describe, expect, it } from 'vitest';

import {
    DEFAULT_DEBOUNCE_MS,
    parseDebounceMs,
    parseDictionaryPaths,
    parseSkipEnvironments,
    parseWordlist,
    wordsAdded,
} from '../config/parsing';

describe('parseDebounceMs', () => {
    it('reads the value the config sets', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: 900\n')).toBe(900);
    });

    it('falls back when the config says nothing', () => {
        expect(parseDebounceMs('engines:\n  harper:\n    enabled: true\n'))
            .toBe(DEFAULT_DEBOUNCE_MS);
    });

    it('falls back on a value that is not a number', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: soon\n'))
            .toBe(DEFAULT_DEBOUNCE_MS);
    });

    it('accepts zero, which means check on every change', () => {
        expect(parseDebounceMs('performance:\n  debounce_ms: 0\n')).toBe(0);
    });

    it('ignores the key inside a comment', () => {
        expect(parseDebounceMs('# debounce_ms: 42\n')).toBe(DEFAULT_DEBOUNCE_MS);
    });
});

describe('parseYamlList', () => {
    it('reads an unquoted list', () => {
        const yaml = 'dictionaries:\n  paths:\n    - words.txt\n    - extra.txt\n';
        expect([...parseDictionaryPaths(yaml)]).toEqual(['words.txt', 'extra.txt']);
    });

    it('drops the quotes a YAML author is entitled to write', () => {
        // The schema reference writes these quoted. Keeping the quotes meant
        // the path was watched as a file whose name began with `"`, so a
        // wordlist edit reached nothing and the words stayed reported.
        const yaml = 'dictionaries:\n  paths:\n    - "words.txt"\n';
        expect([...parseDictionaryPaths(yaml)]).toEqual(['words.txt']);
    });

    it('drops single quotes too', () => {
        const yaml = "dictionaries:\n  paths:\n    - 'words.txt'\n";
        expect([...parseDictionaryPaths(yaml)]).toEqual(['words.txt']);
    });

    it('leaves an unmatched quote alone, because it is part of the name', () => {
        const yaml = 'dictionaries:\n  paths:\n    - "words.txt\n';
        expect([...parseDictionaryPaths(yaml)]).toEqual(['"words.txt']);
    });

    it('returns nothing when the key is absent', () => {
        expect([...parseDictionaryPaths('engines:\n  harper: true\n')]).toEqual([]);
    });

    it('reads the LaTeX lists by their own keys', () => {
        const yaml = 'languages:\n  latex:\n    skip_environments:\n      - "tikzpicture"\n      - align\n';
        expect([...parseSkipEnvironments(yaml)]).toEqual(['tikzpicture', 'align']);
    });
});

describe('parseWordlist', () => {
    it('reads one word per line, folded to lower case', () => {
        expect([...parseWordlist('Zorblat\nQUIXOTRON\n')]).toEqual(['zorblat', 'quixotron']);
    });

    it('skips comments and blank lines, as the core does', () => {
        expect([...parseWordlist('# a note\n\n  zorblat  \n')]).toEqual(['zorblat']);
    });
});

describe('wordsAdded', () => {
    it('names the words an edit adds', () => {
        expect([...wordsAdded('a\n', 'a\nb\n')!]).toEqual(['b']);
    });

    it('is empty when nothing changed but the comments', () => {
        expect([...wordsAdded('a\n', '# new note\na\n')!]).toEqual([]);
    });

    it('returns null when a word is taken away, which needs the check', () => {
        // The finding was dropped inside the core and never reached the
        // editor, so there is nothing to un-filter.
        expect(wordsAdded('a\nb\n', 'a\n')).toBeNull();
    });

    it('returns null when a word is replaced rather than added', () => {
        expect(wordsAdded('a\n', 'b\n')).toBeNull();
    });
});
