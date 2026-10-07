// Base64 for the native host's frames. `Uint8Array.fromBase64`/`toBase64`
// are not in every engine the extension supports yet, so this goes through
// atob/btoa, in chunks small enough for `String.fromCharCode.apply`.
const CHUNK = 0x80_00;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
