// The page is untrusted: these hold the parser to refusing anything that is
// not exactly a request.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { parseBackgroundRequest } from '../../src/messaging/background';
import { MAX_CHECK_TEXT_CHARS, MAX_WORD_CHARS, parsePageRequest, parsePageResponse } from '../../src/messaging/protocol';

describe('parsePageRequest', () => {
    test('accepts the three ops', () => {
        expect(parsePageRequest({ id: 1, op: 'check', text: 'teh', languageId: 'latex' })).toEqual({ id: 1, op: 'check', text: 'teh', languageId: 'latex' });
        expect(parsePageRequest({ id: 2, op: 'addWord', word: "O'Neill-style" })?.op).toBe('addWord');
        expect(parsePageRequest({ id: 3, op: 'ignore', message: 'm', context: 'c', text: 't', startByte: 0, endByte: 3 })?.op).toBe('ignore');
    });

    test.each([
        ['no id', { op: 'check', text: '', languageId: 'latex' }],
        ['zero id', { id: 0, op: 'check', text: '', languageId: 'latex' }],
        ['float id', { id: 1.5, op: 'check', text: '', languageId: 'latex' }],
        ['unknown op', { id: 1, op: 'probeConfig' }],
        ['unknown language', { id: 1, op: 'check', text: '', languageId: 'rust' }],
        ['text too long', { id: 1, op: 'check', text: 'a'.repeat(MAX_CHECK_TEXT_CHARS + 1), languageId: 'latex' }],
        ['empty word', { id: 1, op: 'addWord', word: '' }],
        ['word too long', { id: 1, op: 'addWord', word: 'a'.repeat(MAX_WORD_CHARS + 1) }],
        ['word with a space', { id: 1, op: 'addWord', word: 'two words' }],
        ['word with a newline', { id: 1, op: 'addWord', word: 'a\nb' }],
        ['word with a bidi override', { id: 1, op: 'addWord', word: `ab${String.fromCodePoint(0x20_2E)}cd` }],
        ['word with a zero-width space', { id: 1, op: 'addWord', word: `ab${String.fromCodePoint(0x20_0B)}cd` }],
        ['ignore with reversed bytes', { id: 1, op: 'ignore', message: '', context: '', text: '', startByte: 4, endByte: 2 }],
        ['ignore with a negative byte', { id: 1, op: 'ignore', message: '', context: '', text: '', startByte: -1, endByte: 2 }],
        ['an array', [1, 'check']],
        ['null', null],
    ])('refuses %s', (_, value) => {
        expect(parsePageRequest(value)).toBeUndefined();
    });

    test('words are stored in NFC, so one word is one dictionary entry', () => {
        const decomposed = 'café';
        expect(parsePageRequest({ id: 1, op: 'addWord', word: decomposed })).toMatchObject({ word: 'café' });
    });

    test('never throws, whatever arrives', () => {
        fc.assert(fc.property(fc.anything(), (value) => void parsePageRequest(value)));
        fc.assert(fc.property(fc.anything(), (value) => void parsePageResponse(value)));
        fc.assert(fc.property(fc.anything(), (value) => void parseBackgroundRequest(value)));
    });
});

describe('parsePageResponse', () => {
    test('drops a response with a malformed diagnostic rather than half of it', () => {
        expect(parsePageResponse({ id: 1, ok: true, diagnostics: [{ startByte: 5, endByte: 1, message: '', severity: 1, suggestions: [] }] })).toBeUndefined();
        expect(parsePageResponse({ id: 1, ok: true, diagnostics: [{ startByte: 0, endByte: 1, message: 'm', severity: 1, suggestions: [3] }] })).toBeUndefined();
    });

    test('accepts errors only with a known code', () => {
        expect(parsePageResponse({ id: 1, ok: false, error: 'x', code: 'unavailable' })).toEqual({ id: 1, ok: false, error: 'x', code: 'unavailable' });
        expect(parsePageResponse({ id: 1, ok: false, error: 'x', code: 'whatever' })).toBeUndefined();
    });
});

describe('parseBackgroundRequest', () => {
    test('carries no workspace: a key in the message is not read', () => {
        const parsed = parseBackgroundRequest({ id: 1, key: 'typst-someone-else', request: { id: 1, op: 'addWord', word: 'teh' } });
        expect(parsed).toEqual({ id: 1, request: { id: 1, op: 'addWord', word: 'teh' } });
    });
});
