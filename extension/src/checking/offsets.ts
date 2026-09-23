/**
 * The two kinds of text offset the extension handles, kept apart by type.
 *
 * The core reports UTF-8 byte offsets; the editor works in UTF-16 code units.
 * Both are plain numbers at runtime, and on ASCII text they are even equal, so
 * passing one where the other belongs survives every English test and breaks
 * on the first `é`. Branding them makes that a compile error: a byte offset
 * only comes from {@link coreByte}, and only {@link byteToCharConverter} turns
 * one into a character offset.
 */

declare const byteOffset: unique symbol;
declare const charOffset: unique symbol;

/** An offset into the UTF-8 encoding of a text, as the core reports them. */
export type ByteOffset = number & { readonly [byteOffset]: true };

/** An offset into a JS string (UTF-16 code units), as `document.positionAt` takes them. */
export type CharOffset = number & { readonly [charOffset]: true };

/**
 * A byte offset read off the core's wire format.
 *
 * Protobuf marks the field optional; the core always sets it, and the
 * extension has always read it with a plain cast, which this keeps.
 */
export function coreByte(value: number | null | undefined): ByteOffset {
    return value as ByteOffset;
}

/**
 * A converter from byte offsets in `text` to string offsets, built in one
 * pass over the text.
 *
 * Its answers are those of decoding the prefix through a `Buffer`, which is
 * how it used to work and what fixes the behaviour for an offset inside a
 * multi-byte character: the partial sequence decodes to one U+FFFD, one code
 * unit. Decoding per call cost the length of the prefix every time, and the
 * checker converts two offsets per diagnostic, so a large document with many
 * findings spent seconds here after the core had long answered. A table
 * over every byte offset answers in constant time; the property test in
 * offsets.test.ts holds it to the decode on arbitrary text.
 */
export function byteToCharConverter(text: string): (byteOffset: ByteOffset) => CharOffset {
    const total = Buffer.byteLength(text, 'utf8');
    const table = new Uint32Array(total + 1);
    let byte = 0;
    let unit = 0;
    for (const char of text) {
        const point = char.codePointAt(0) ?? 0;
        // A lone surrogate encodes as U+FFFD, three bytes, like the rest of
        // its range.
        const length = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x1_0000 ? 3 : 4;
        table[byte] = unit;
        table.fill(unit + 1, byte + 1, byte + length);
        byte += length;
        unit += char.length;
    }
    table[byte] = unit;
    return (offset: ByteOffset) => table[prefixEnd(offset, total)] as CharOffset;
}

/**
 * Where `subarray(0, offset)` ends, which is what the offsets meant when they
 * were decoded that way: past the end is the end, a negative offset counts
 * from it, and a missing one is the whole text.
 */
function prefixEnd(offset: number | undefined, total: number): number {
    if (offset === undefined) return total;
    const whole = Math.trunc(offset);
    if (Number.isNaN(whole)) return 0;
    return whole < 0 ? Math.max(total + whole, 0) : Math.min(whole, total);
}
