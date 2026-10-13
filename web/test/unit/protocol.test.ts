// The page is untrusted: these hold the parser to refusing anything that is
// not exactly a request.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseBackgroundRequest } from '../../src/messaging/background';
import { readFileSync } from 'node:fs';
import { DEFAULT_CHECK_SETTINGS, EXTRAS_BUDGET_BYTES, MAX_CHECK_TEXT_BYTES, MAX_CHECK_TEXT_CHARS, MAX_FOREIGN_FINDINGS, MAX_WORD_CHARS, parseCheckSettings, parsePageRequest, parsePageResponse, withinCheckLimits } from '../../src/messaging/protocol';

describe('parsePageRequest', () => {
    const req = (request: unknown) => ({ id: 1, request });
    test('accepts the five requests a page may make, rebuilt from their allowed fields', () => {
        expect(parsePageRequest(req({ checkProse: { text: 'teh', languageId: 'latex', filePath: '/etc/hosts', settings: { x: 1 } } }))).toEqual(req({ checkProse: { text: 'teh', languageId: 'latex' } }));
        expect(parsePageRequest(req({ addDictionaryWord: { word: "O'Neill-style" } }))?.request).toEqual({ addDictionaryWord: { word: "O'Neill-style" } });
        expect(parsePageRequest(req({ ignore: { message: 'm', context: 'c', text: 't', startByte: 0, endByte: 3 } }))).toBeDefined();
        expect(parsePageRequest(req({ getMetadata: {} }))?.request).toEqual({ getMetadata: {} });
        // Which config is in force, by name: never its text, which can hold an API key.
        expect(parsePageRequest(req({ listConfigFiles: { path: '/etc' } }))?.request).toEqual({ listConfigFiles: {} });
        expect(parsePageRequest(req({ readConfig: {} }))).toBeUndefined();
        expect(parsePageRequest(req({ writeConfig: { text: 'x' } }))).toBeUndefined();
    });

    test.each([
        ['no id', { request: { getMetadata: {} } }],
        ['zero id', { id: 0, request: { getMetadata: {} } }],
        ['float id', { id: 1.5, request: { getMetadata: {} } }],
        ['no payload', req({})],
        ['two payloads', req({ getMetadata: {}, addDictionaryWord: { word: 'x' } })],
        ['config probing', req({ probeConfig: { text: '', filePath: '/x', format: 'yaml' } })],
        ['initialize (the background does that)', req({ initialize: { workspaceRoot: '/home' } })],
        ['an unknown language', req({ checkProse: { text: '', languageId: 'rust' } })],
        ['text too long', req({ checkProse: { text: 'a'.repeat(MAX_CHECK_TEXT_CHARS + 1), languageId: 'latex' } })],
        ['text past the host\'s byte cap (wide characters)', req({ checkProse: { text: 'é€'.repeat(MAX_CHECK_TEXT_BYTES / 4), languageId: 'latex' } })],
        ['an ignore whose text is past the byte cap', req({ ignore: { message: 'm', context: 'c', text: 'é€'.repeat(MAX_CHECK_TEXT_BYTES / 4), startByte: 0, endByte: 1 } })],
        ['an empty word', req({ addDictionaryWord: { word: '' } })],
        ['a word too long', req({ addDictionaryWord: { word: 'a'.repeat(MAX_WORD_CHARS + 1) } })],
        ['a word with a space', req({ addDictionaryWord: { word: 'two words' } })],
        ['a word with a newline', req({ addDictionaryWord: { word: 'a\nb' } })],
        ['a word with a bidi override', req({ addDictionaryWord: { word: `ab${String.fromCodePoint(0x20_2E)}cd` } })],
        ['a word with a zero-width space', req({ addDictionaryWord: { word: `ab${String.fromCodePoint(0x20_0B)}cd` } })],
        ['ignore with reversed bytes', req({ ignore: { message: '', context: '', text: '', startByte: 4, endByte: 2 } })],
        ['ignore with a negative byte', req({ ignore: { message: '', context: '', text: '', startByte: -1, endByte: 2 } })],
        ['a payload that is not an object', req({ checkProse: 'teh' })],
        ['an array', [1, 'check']],
        ['null', null],
    ])('refuses %s', (_, value) => {
        expect(parsePageRequest(value)).toBeUndefined();
    });

    test('words are stored in NFC, so one word is one dictionary entry', () => {
        expect(parsePageRequest(req({ addDictionaryWord: { word: 'cafe\u{301}' } }))?.request).toEqual({ addDictionaryWord: { word: 'caf\u{E9}' } });
    });

    test('never throws, whatever arrives', () => {
        fc.assert(fc.property(fc.anything(), (value) => void parsePageRequest(value)));
        fc.assert(fc.property(fc.anything(), (value) => void parsePageResponse(value)));
        fc.assert(fc.property(fc.anything(), (value) => void parseBackgroundRequest(value)));
    });
});

describe("the site's own checker's findings on a check", () => {
    const sound = { checker: 'typst', rule: 'misspelling', category: 1, startByte: 4, endByte: 7, message: 'the word "teh"', language: 'en' };
    const check = (foreign: unknown) => parsePageRequest({ id: 1, request: { checkProse: { text: 'one teh', languageId: 'typst', foreign } } })?.request;
    test('sound entries are rebuilt from their fields; a check without any carries none', () => {
        expect(check([{ ...sound, extra: 'x' }])).toEqual({ checkProse: { text: 'one teh', languageId: 'typst', foreign: [sound] } });
        expect(check([{ ...sound, message: undefined, language: undefined }])).toEqual({ checkProse: { text: 'one teh', languageId: 'typst', foreign: [{ ...sound, message: '', language: '' }] } });
        expect(check([])).toEqual({ checkProse: { text: 'one teh', languageId: 'typst' } });
        expect(check(undefined)).toEqual({ checkProse: { text: 'one teh', languageId: 'typst' } });
    });
    test.each([
        ['a name that could not be a rule id', { ...sound, checker: 'Typst.x' }],
        ['an unknown category', { ...sound, category: 2 }],
        ['an empty span', { ...sound, endByte: 4 }],
        ['a negative offset', { ...sound, startByte: -1 }],
        ['a long message', { ...sound, message: 'x'.repeat(1001) }],
        ['a language that is not text', { ...sound, language: 7 }],
        ['not an object', 'teh'],
    ])('an entry with %s is dropped, not the check', (_name, entry) => {
        expect(check([entry, sound])).toEqual({ checkProse: { text: 'one teh', languageId: 'typst', foreign: [sound] } });
    });
    // One request is one browser message to the native host (8 MiB, as
    // base64): findings that would push it past that end the connection.
    test('foreign findings stay within the byte budget, and messages are cut to the core\'s length', () => {
        const long = { ...sound, message: 'é'.repeat(1000) };
        const taken = (check(Array.from({ length: 2000 }, () => long)) as { checkProse: { foreign: { message: string }[] } }).checkProse.foreign;
        expect(taken[0]?.message).toHaveLength(500);
        const bytes = taken.reduce((sum, f) => sum + 32 + new TextEncoder().encode(f.message + 'typstmisspellingen').length, 0);
        expect(bytes).toBeLessThanOrEqual(EXTRAS_BUDGET_BYTES);
        expect(taken.length).toBeLessThan(2000);
    });

    test('at most MAX_FOREIGN_FINDINGS are taken', () => {
        // Small findings: the count cap or the byte budget, whichever comes first.
        const many = check(Array.from({ length: MAX_FOREIGN_FINDINGS + 3 }, () => sound)) as { checkProse: { foreign: unknown[] } };
        expect(many.checkProse.foreign.length).toBeLessThanOrEqual(MAX_FOREIGN_FINDINGS);
        expect(many.checkProse.foreign).toHaveLength(Math.min(MAX_FOREIGN_FINDINGS, Math.floor(EXTRAS_BUDGET_BYTES / (32 + 'typstmisspellingthe word "teh"en'.length))));
    });
});

describe('a check window', () => {
    const check = (window: unknown) => parsePageRequest({ id: 1, request: { checkProse: { text: 'teh', languageId: 'latex', window } } })?.request;
    test('two byte offsets in order are kept, and nothing else of the window', () => {
        expect(check({ startByte: 0, endByte: 1024, extra: 1 })).toEqual({ checkProse: { text: 'teh', languageId: 'latex', window: { startByte: 0, endByte: 1024 } } });
        expect(check({ startByte: 5, endByte: 5 })).toBeDefined();
        expect(check(undefined)).toEqual({ checkProse: { text: 'teh', languageId: 'latex' } });
    });
    test.each([
        ['backwards', { startByte: 9, endByte: 3 }],
        ['negative', { startByte: -1, endByte: 3 }],
        ['fractional', { startByte: 0.5, endByte: 3 }],
        ['past 32 bits', { startByte: 0, endByte: 2 ** 32 }],
        ['a string', '0-3'],
        ['missing an end', { startByte: 0 }],
    ])('a window %s refuses the check', (_name, window) => {
        expect(check(window)).toBeUndefined();
    });
});

describe('parseCheckSettings', () => {
    test('sound values are kept', () => {
        expect(parseCheckSettings({ progressive: true, windowBytes: 4096, maxBytes: 65_536, foreignCheckers: 'both' })).toEqual({ progressive: true, windowBytes: 4096, maxBytes: 65_536, foreignCheckers: 'both' });
    });
    test('each unsound field falls back to its default alone', () => {
        expect(parseCheckSettings({ progressive: 'yes', windowBytes: 10, maxBytes: -1, foreignCheckers: 'all' })).toEqual(DEFAULT_CHECK_SETTINGS);
        expect(parseCheckSettings({ progressive: true, windowBytes: 2 ** 21, maxBytes: 1.5 })).toEqual({ ...DEFAULT_CHECK_SETTINGS, progressive: true });
        expect(parseCheckSettings(null)).toEqual(DEFAULT_CHECK_SETTINGS);
        expect(parseCheckSettings('progressive')).toEqual(DEFAULT_CHECK_SETTINGS);
    });
});

describe('parsePageResponse', () => {
    test('passes an ok response through and accepts errors only with a known code', () => {
        expect(parsePageResponse({ id: 1, ok: true, response: { ok: {} } })).toEqual({ id: 1, ok: true, response: { ok: {} } });
        expect(parsePageResponse({ id: 1, ok: true })).toBeUndefined();
        expect(parsePageResponse({ id: 1, ok: false, error: 'x', code: 'unavailable' })).toEqual({ id: 1, ok: false, error: 'x', code: 'unavailable' });
        expect(parsePageResponse({ id: 1, ok: false, error: 'x', code: 'whatever' })).toBeUndefined();
    });
});

describe('parseBackgroundRequest', () => {
    test('carries no workspace: a key in the message is not read', () => {
        const parsed = parseBackgroundRequest({ id: 1, key: 'typst-someone-else', request: { id: 1, request: { addDictionaryWord: { word: 'teh' } } } });
        expect(parsed).toEqual({ id: 1, request: { id: 1, request: { addDictionaryWord: { word: 'teh' } } } });
    });
});

describe('withinCheckLimits', () => {
    test('holds the page to both caps: characters, and the host\'s bytes', () => {
        expect(withinCheckLimits('a'.repeat(MAX_CHECK_TEXT_CHARS))).toBe(true);
        expect(withinCheckLimits('a'.repeat(MAX_CHECK_TEXT_CHARS + 1))).toBe(false);
        // Within the character cap, past the byte cap: 3 bytes a character.
        const wide = 'é€'.repeat(MAX_CHECK_TEXT_BYTES / 4);
        expect(wide.length).toBeLessThanOrEqual(MAX_CHECK_TEXT_CHARS);
        expect(withinCheckLimits(wide)).toBe(false);
    });

    test('the byte cap is the native host\'s', () => {
        const source = readFileSync(new URL('../../../rust-core/src/native_host.rs', import.meta.url), 'utf8');
        const match = /pub const MAX_CHECK_TEXT_BYTES: usize = (\d+) \* (\d+) \* (\d+);/u.exec(source);
        expect(match?.slice(1).reduce((product, factor) => product * Number(factor), 1)).toBe(MAX_CHECK_TEXT_BYTES);
    });
});
