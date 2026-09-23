/**
 * Mapping a dotted key back to a position in the buffer.
 *
 * The core answers about keys by path because serde has no byte offsets to
 * give it. Everything the editor draws therefore depends on this file getting
 * the same key back to the same range, so the cases here are the shapes a
 * config actually takes: the bool shorthand, the nested block, a list, and a
 * key that is not written down at all.
 */
import { describe, expect, it } from 'vitest';

import { parseConfigKeys, spanForKey } from '../config/keys';

/** The text a span covers, which is what an assertion can read. */
function textAt(source: string, key: string, which: 'key' | 'value' = 'value'): string {
    const parsed = parseConfigKeys(source);
    const span = spanForKey(parsed.spans, key);
    if (span === undefined) throw new Error(`no span for ${key}`);
    return which === 'key'
        ? source.slice(span.keyStart, span.keyEnd)
        : source.slice(span.valueStart, span.valueEnd).trim();
}

const NESTED = `engines:
  harper:
    enabled: true
    dialect: "American"
    linters:
      LongSentences: false
  languagetool:
    enabled: true
    url: "http://localhost:8010"
    disabled_rules:
      - WHITESPACE_RULE
      - EN_QUOTES
  spell_language: "en-US"
`;

describe('config key spans', () => {
    it('finds a nested scalar by its dotted path', () => {
        expect(textAt(NESTED, 'engines.languagetool.url')).toBe('"http://localhost:8010"');
        expect(textAt(NESTED, 'engines.spell_language')).toBe('"en-US"');
    });

    it('points the key span at the key and the value span at the value', () => {
        expect(textAt(NESTED, 'engines.languagetool.url', 'key')).toBe('url');
        expect(textAt(NESTED, 'engines.languagetool.url', 'value')).toBe('"http://localhost:8010"');
    });

    it('names a list entry by its index, because a rule id is not unique', () => {
        expect(textAt(NESTED, 'engines.languagetool.disabled_rules.0')).toBe('WHITESPACE_RULE');
        expect(textAt(NESTED, 'engines.languagetool.disabled_rules.1')).toBe('EN_QUOTES');
    });

    it('reaches a key inside a map of rule toggles', () => {
        expect(textAt(NESTED, 'engines.harper.linters.LongSentences', 'key'))
            .toBe('LongSentences');
    });

    it('handles the bool shorthand, where the engine has no block of its own', () => {
        const source = 'engines:\n  harper: true\n  vale: false\n';
        expect(textAt(source, 'engines.harper')).toBe('true');
        expect(textAt(source, 'engines.vale')).toBe('false');
    });

    it('falls back to the nearest written ancestor for a key that relies on a default', () => {
        // `url` is never written, so a probe about it has to land somewhere;
        // the block header is where a reader would look.
        const source = 'engines:\n  languagetool:\n    enabled: true\n';
        const parsed = parseConfigKeys(source);
        const span = spanForKey(parsed.spans, 'engines.languagetool.url');
        expect(span).toBeDefined();
        expect(source.slice(span!.keyStart, span!.keyEnd)).toBe('languagetool');
    });

    it('returns nothing for a path with no ancestor in the document', () => {
        const parsed = parseConfigKeys('engines:\n  harper: true\n');
        expect(spanForKey(parsed.spans, 'rules.Foo.severity')).toBeUndefined();
    });

    it('reports a duplicate key, which the README sample invites', () => {
        // Both spellings are documented, and a reader who copies both gets
        // the key twice. YAML keeps the last, so the shorthand vanishes with
        // nothing to say so.
        const source = 'engines:\n  harper: true\n  harper:\n    enabled: true\n';
        const parsed = parseConfigKeys(source);
        const duplicate = parsed.problems.find(p => /unique/i.test(p.message));
        expect(duplicate).toBeDefined();
        expect(duplicate!.fatal).toBe(false);
        expect(duplicate!.message).toMatch(/falls back to its default/);
        // Over the key, not over the single column the parser reports: a
        // one-character underline next to the word that is wrong reads as a
        // stray mark.
        expect(source.slice(duplicate!.start, duplicate!.end)).toBe('harper');
    });

    it('still gives spans for the rest of a file that has a duplicate key', () => {
        // The finding is worth reporting; it is not a reason to stop marking
        // every other key in the file.
        const source = 'engines:\n  harper: true\n  harper:\n    enabled: true\n  vale: false\n';
        const parsed = parseConfigKeys(source);
        expect(parsed.parsed).toBe(true);
        expect(spanForKey(parsed.spans, 'engines.vale')).toBeDefined();
    });

    it('reports a document that will not parse, and gives up on spans', () => {
        const parsed = parseConfigKeys('engines:\n  harper: true\n   bad_indent: 1\n');
        expect(parsed.parsed).toBe(false);
        expect(parsed.problems.some(p => p.fatal)).toBe(true);
    });

    it('parses an empty document without complaining', () => {
        const parsed = parseConfigKeys('');
        expect(parsed.problems).toHaveLength(0);
        expect(parsed.spans.size).toBe(0);
    });

    it('covers exactly the quoted value, and not the comment after it', () => {
        const source = 'engines:\n  languagetool:\n    url: "http://localhost:8010"  # the default\n';
        expect(textAt(source, 'engines.languagetool.url')).toBe('"http://localhost:8010"');
    });

    it('covers a path that has spaces in it', () => {
        // Windows, mostly. A span that stopped at the first space would
        // underline half a path and read as a different mistake.
        const source = 'engines:\n  vale:\n    config: "C:/Program Files/vale/.vale.ini"\n';
        expect(textAt(source, 'engines.vale.config'))
            .toBe('"C:/Program Files/vale/.vale.ini"');
    });

    it('is not thrown off by an em dash earlier on the line', () => {
        // The offsets `yaml` reports are UTF-16 indices, which is what
        // `positionAt` takes -- so a multi-byte character must not shift the
        // span the way it did for Vale's rune columns.
        const source = 'engines:\n  # dash — here\n  vale:\n    config: "café/.vale.ini"\n';
        expect(textAt(source, 'engines.vale.config')).toBe('"café/.vale.ini"');
    });

    it('covers a value holding non-ASCII of its own', () => {
        const source = 'engines:\n  spell_language: "de-DE"\n  vale:\n    config: "ü—ñ/.vale.ini"\n';
        expect(textAt(source, 'engines.vale.config')).toBe('"ü—ñ/.vale.ini"');
        expect(textAt(source, 'engines.spell_language')).toBe('"de-DE"');
    });

    it('covers an unquoted value exactly, stopping before the comment', () => {
        const source = 'engines:\n  languagetool:\n    url: http://localhost:8010 # no quotes\n';
        expect(textAt(source, 'engines.languagetool.url')).toBe('http://localhost:8010');
    });

    it('keeps the key span to the key when the value is long', () => {
        const source = 'engines:\n  vale:\n    config: "a very long path with spaces/.vale.ini"\n';
        expect(textAt(source, 'engines.vale.config', 'key')).toBe('config');
    });

    it('reads JSON, since YAML 1.2 is a superset of it', () => {
        const source = '{"engines": {"harper": true, "spell_language": "de-DE"}}';
        expect(textAt(source, 'engines.spell_language')).toBe('"de-DE"');
    });
});
