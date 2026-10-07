// The shim's TextDocument position math, checked against a plain reference
// model: every offset round-trips, and out-of-range input clamps the way
// VS Code clamps it instead of producing positions past the text.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { EditorAdapter } from '../../src/editor/types';
import { Position, TextDocument } from '../../src/shim/vscode';

const docOf = (text: string): TextDocument =>
    new TextDocument({ uri: 'test:/doc', languageId: 'plaintext', getText: () => text } as unknown as EditorAdapter);

/** Reference: count newlines before `offset`. */
function referencePosition(text: string, offset: number): { line: number; character: number } {
    const before = text.slice(0, offset);
    const line = before.split('\n').length - 1;
    return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

const text = fc.string({ unit: fc.constantFrom('a', 'b', '\n', 'é', '😀') });

describe('TextDocument', () => {
    test('positionAt matches the reference and offsetAt inverts it', () => {
        fc.assert(
            fc.property(text, fc.nat(), (t, n) => {
                const doc = docOf(t);
                const offset = t.length === 0 ? 0 : n % (t.length + 1);
                const position = doc.positionAt(offset);
                expect({ line: position.line, character: position.character }).toEqual(referencePosition(t, offset));
                expect(doc.offsetAt(position)).toBe(offset);
            }),
        );
    });

    test('out-of-range offsets clamp to the document', () => {
        fc.assert(
            fc.property(text, fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 1 }), fc.constantFrom(NaN, Infinity, -Infinity)), (t, bad) => {
                const doc = docOf(t);
                const offset = doc.offsetAt(doc.positionAt(bad < 0 || Number.isNaN(bad) ? bad : t.length + bad));
                expect(offset).toBeGreaterThanOrEqual(0);
                expect(offset).toBeLessThanOrEqual(t.length);
            }),
        );
    });

    test('offsetAt clamps characters to the line and lines to the document, like VS Code', () => {
        const doc = docOf('ab\ncd');
        expect(doc.offsetAt(new Position(0, 99))).toBe(2);
        expect(doc.offsetAt(new Position(9, 0))).toBe(5);
        expect(doc.offsetAt(new Position(-1, 3))).toBe(0);
        expect(doc.offsetAt(new Position(1, -4))).toBe(3);
    });

    test('positionAt is logarithmic, not a scan per call', () => {
        const big = 'word\n'.repeat(200_000);
        const doc = docOf(big);
        const start = performance.now();
        for (let i = 0; i < 100_000; i++) doc.positionAt((i * 7919) % big.length);
        // A linear scan takes ~minutes here; binary search takes milliseconds.
        expect(performance.now() - start).toBeLessThan(1000);
    });

    test('getWordRangeAtPosition finds the word around the cursor', () => {
        const doc = docOf('one teh, two');
        const range = doc.getWordRangeAtPosition(new Position(0, 5));
        expect(range && doc.getText(range)).toBe('teh');
        expect(doc.getWordRangeAtPosition(new Position(0, 7))?.end.character).toBe(7);
    });
});
