import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { byteToCharConverter, coreByte } from '../checking/offsets';

/**
 * How offsets were converted before the table: decode the prefix. Kept as
 * the oracle, since its answers -- one U+FFFD for an offset inside a
 * character -- are what every caller was written against.
 */
function decodePrefix(text: string, offset: number | undefined): number {
    return Buffer.from(text, 'utf8').subarray(0, offset).toString('utf8').length;
}

/** Text built from every UTF-8 width, plus lone surrogates, which JS strings allow. */
const text = fc.array(
    fc.oneof(
        fc.constantFrom('a', ' ', '\n', '\t', '\u0000'),
        fc.integer({ min: 0x80, max: 0x7ff }).map(point => String.fromCodePoint(point)),
        fc.integer({ min: 0x800, max: 0xffff })
            .filter(point => point < 0xd800 || point > 0xdfff)
            .map(point => String.fromCodePoint(point)),
        fc.integer({ min: 0x1_0000, max: 0x10_ffff }).map(point => String.fromCodePoint(point)),
        fc.integer({ min: 0xd800, max: 0xdfff }).map(unit => String.fromCharCode(unit)),
    ),
    { maxLength: 60 },
).map(parts => parts.join(''));

describe('byteToCharConverter', () => {
    it('answers as decoding the prefix does, at every byte offset of any text', () => {
        fc.assert(fc.property(text, sample => {
            const convert = byteToCharConverter(sample);
            const total = Buffer.byteLength(sample, 'utf8');
            for (let offset = -total - 2; offset <= total + 2; offset++) {
                expect(convert(coreByte(offset)), `offset ${offset} of ${JSON.stringify(sample)}`)
                    .toBe(decodePrefix(sample, offset));
            }
        }), { numRuns: 2_000 });
    });

    it('treats a missing offset as the whole text, as the decode did', () => {
        fc.assert(fc.property(text, sample => {
            expect(byteToCharConverter(sample)(coreByte(undefined))).toBe(decodePrefix(sample, undefined));
        }));
    });

    it('converts a large document with many findings without decoding it per finding', () => {
        // The case the table exists for: a megabyte of mixed-width text and
        // ten thousand offsets, which decoding per call took seconds over.
        const sample = 'Wisława Szymborska \u{1f600} prose '.repeat(30_000);
        const total = Buffer.byteLength(sample, 'utf8');
        const convert = byteToCharConverter(sample);
        const started = performance.now();
        for (let i = 0; i < 10_000; i++) convert(coreByte(Math.floor((i / 10_000) * total)));
        expect(performance.now() - started).toBeLessThan(500);
    });
});
