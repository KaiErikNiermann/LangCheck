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
 * A converter from byte offsets in `text` to string offsets, sharing one
 * encoding of it.
 *
 * Converted through a `Buffer` decode of the prefix, which is also what fixes
 * the behaviour for an offset that lands inside a multi-byte character: the
 * partial sequence decodes to U+FFFD and counts as one code unit.
 */
export function byteToCharConverter(text: string): (byteOffset: ByteOffset) => CharOffset {
    const encoded = Buffer.from(text, 'utf8');
    return (offset: ByteOffset) => encoded.subarray(0, offset).toString('utf8').length as CharOffset;
}
