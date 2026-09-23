/**
 * The core reports UTF-8 byte offsets; the editor works in UTF-16 code units.
 *
 * Converted through a `Buffer` decode of the prefix, which is also what fixes
 * the behaviour for an offset that lands inside a multi-byte character: the
 * partial sequence decodes to U+FFFD and counts as one code unit.
 */

/** A converter from byte offsets in `text` to string offsets, sharing one encoding of it. */
export function byteToCharConverter(text: string): (byteOffset: number) => number {
    const encoded = Buffer.from(text, 'utf8');
    return (byteOffset: number) => encoded.subarray(0, byteOffset).toString('utf8').length;
}
