// The page is untrusted: these hold the parser to refusing anything that is
// not exactly a request.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseBackgroundRequest } from '../../src/messaging/background';
import { readFileSync } from 'node:fs';
import { MAX_CHECK_TEXT_BYTES, MAX_CHECK_TEXT_CHARS, MAX_WORD_CHARS, parsePageRequest, parsePageResponse, withinCheckLimits } from '../../src/messaging/protocol';

describe('parsePageRequest', () => {
    const req = (request: unknown) => ({ id: 1, request });
    test('accepts the four requests a page may make, rebuilt from their allowed fields', () => {
        expect(parsePageRequest(req({ checkProse: { text: 'teh', languageId: 'latex', filePath: '/etc/hosts', settings: { x: 1 } } }))).toEqual(req({ checkProse: { text: 'teh', languageId: 'latex' } }));
        expect(parsePageRequest(req({ addDictionaryWord: { word: "O'Neill-style" } }))?.request).toEqual({ addDictionaryWord: { word: "O'Neill-style" } });
        expect(parsePageRequest(req({ ignore: { message: 'm', context: 'c', text: 't', startByte: 0, endByte: 3 } }))).toBeDefined();
        expect(parsePageRequest(req({ getMetadata: {} }))?.request).toEqual({ getMetadata: {} });
    });

    test.each([
        ['no id', { request: { getMetadata: {} } }],
        ['zero id', { id: 0, request: { getMetadata: {} } }],
        ['float id', { id: 1.5, request: { getMetadata: {} } }],
        ['no payload', req({})],
        ['two payloads', req({ getMetadata: {}, addDictionaryWord: { word: 'x' } })],
        ['config probing', req({ probeConfig: { text: '', filePath: '/x', format: 'yaml' } })],
        ['listing config files', req({ listConfigFiles: {} })],
        ['initialize (the background does that)', req({ initialize: { workspaceRoot: '/home' } })],
        ['an unknown language', req({ checkProse: { text: '', languageId: 'rust' } })],
        ['text too long', req({ checkProse: { text: 'a'.repeat(MAX_CHECK_TEXT_CHARS + 1), languageId: 'latex' } })],
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
