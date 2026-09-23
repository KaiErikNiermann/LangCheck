/**
 * The config edits, held to what the file means rather than to its text.
 *
 * Each edit rewrites the user's `.languagecheck.yaml` in place. A config is
 * generated as data, written out in one of the layouts people actually use
 * -- either indent, flow or block collections, comments that mention the
 * keys, CRLF -- then edited, and the result parsed back: the edited value has
 * to be what was asked for, and everything else what it was.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
    addLatexListEntry, deactivateRule, engineEnabled, setEngineEnabled, setSpellLanguage, spellLanguageOf,
    type LatexList,
} from '../config/edits';

const LISTS: readonly LatexList[] = ['skip_environments', 'prose_environments', 'skip_commands'];
const ENGINES = ['harper', 'languagetool', 'vale', 'proselint'] as const;

const identifier = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);
const languageTag = fc.constantFrom('en-US', 'en-GB', 'de-DE', 'fr', 'es', 'nl-NL');
const engineValue = fc.oneof(fc.boolean(), fc.record({ enabled: fc.boolean() }));

interface Config {
    engines?: Record<string, unknown>;
    languages?: { latex?: Partial<Record<LatexList, string[]>> };
    rules?: Record<string, { severity: string }>;
    exclude?: string[];
}

const config: fc.Arbitrary<Config> = fc.record({
    engines: fc.record({
        harper: engineValue,
        languagetool: engineValue,
        vale: engineValue,
        spell_language: languageTag,
    }, { requiredKeys: [] }),
    languages: fc.record({
        latex: fc.record({
            skip_environments: fc.array(identifier, { maxLength: 3 }),
            prose_environments: fc.array(identifier, { maxLength: 3 }),
            skip_commands: fc.array(identifier, { maxLength: 3 }),
        }, { requiredKeys: [] }),
    }, { requiredKeys: [] }),
    rules: fc.dictionary(fc.stringMatching(/^[a-z]+\.[a-z_]{1,8}$/), fc.record({ severity: fc.constantFrom('warning', 'error') }), { maxKeys: 2 }),
    exclude: fc.array(fc.constantFrom('node_modules/**', 'build/**', 'docs/drafts/**'), { maxLength: 2 }),
}, { requiredKeys: [] });

interface Layout {
    readonly indent: 2 | 4;
    readonly flow: boolean;
    readonly comments: boolean;
    readonly crlf: boolean;
}

const layout: fc.Arbitrary<Layout> = fc.record({
    indent: fc.constantFrom(2 as const, 4 as const),
    flow: fc.boolean(),
    comments: fc.boolean(),
    crlf: fc.boolean(),
});

/** The config as a person might have written it. */
function write(value: Config, how: Layout): string {
    let text = YAML.stringify(value, { indent: how.indent, collectionStyle: how.flow ? 'flow' : 'block' });
    if (how.comments) {
        // Comments that name the keys the edits look for.
        text = `# spell_language: set below, latex: lists too\n# engines: and rules: follow\n${text}`;
    }
    return how.crlf ? text.replace(/\n/g, '\r\n') : text;
}

/** Parse, failing the property with the text when it is not YAML any more. */
function read(text: string): Config {
    const document = YAML.parseDocument(text, { uniqueKeys: true });
    if (document.errors.length > 0) {
        throw new Error(`not valid YAML after the edit:\n${text}\n${document.errors.map(e => e.message).join('\n')}`);
    }
    return (document.toJS() ?? {}) as Config;
}

/** `value` with one path set, as the edit is supposed to leave it. */
function withPath(value: Config, path: readonly string[], leaf: unknown): Config {
    const copy = structuredClone(value) as Record<string, unknown>;
    let node = copy;
    for (const key of path.slice(0, -1)) {
        const next = node[key];
        if (typeof next !== 'object' || next === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1] as string] = leaf;
    return copy as Config;
}

const RUNS = { numRuns: 500 };

describe('config edits', () => {
    it('setSpellLanguage sets exactly engines.spell_language', () => {
        fc.assert(fc.property(config, layout, languageTag, (value, how, language) => {
            const edited = read(setSpellLanguage(write(value, how), language));
            expect(edited).toEqual(withPath(value, ['engines', 'spell_language'], language));
        }), RUNS);
    });

    it('spellLanguageOf reads what the file says', () => {
        fc.assert(fc.property(config, layout, (value, how) => {
            expect(spellLanguageOf(write(value, how))).toBe(value.engines?.spell_language ?? 'en-US');
        }), RUNS);
    });

    it('setEngineEnabled turns exactly that engine on or off', () => {
        fc.assert(fc.property(config, layout, fc.constantFrom(...ENGINES), fc.boolean(), (value, how, engine, enabled) => {
            const edited = read(setEngineEnabled(write(value, how), engine, enabled));
            const current = value.engines?.[engine];
            const leaf = typeof current === 'object' && current !== null ? { ...current, enabled } : enabled;
            expect(edited).toEqual(withPath(value, ['engines', engine], leaf));
            expect(engineEnabled(setEngineEnabled(write(value, how), engine, enabled), engine, !enabled)).toBe(enabled);
        }), RUNS);
    });

    it('addLatexListEntry adds exactly one entry to that list', () => {
        fc.assert(fc.property(config, layout, fc.constantFrom(...LISTS), identifier, (value, how, list, name) => {
            const edited = read(addLatexListEntry(write(value, how), list, name));
            const before = value.languages?.latex?.[list] ?? [];
            const after = edited.languages?.latex?.[list] ?? [];
            expect([...after].sort()).toEqual([...before, name].sort());
            expect(edited).toEqual(withPath(value, ['languages', 'latex', list], after));
        }), RUNS);
    });

    it('deactivateRule switches exactly that rule off', () => {
        fc.assert(fc.property(config, layout, fc.stringMatching(/^[a-z]+\.[A-Za-z_]{1,8}$/), (value, how, rule) => {
            const { content } = deactivateRule(write(value, how), rule);
            const edited = read(content);
            if (value.rules?.[rule]) return; // present already: left alone, by design
            expect(edited).toEqual(withPath(value, ['rules', rule], { severity: 'off' }));
        }), RUNS);
    });
});
