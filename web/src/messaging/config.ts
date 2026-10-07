// Messages between the extension's config page and the background. The
// config page is the extension's own (a trusted origin), and this port is
// the only way to read, write or probe a workspace's config: a probe fetches
// URLs and stats files, and the text can hold an API key, so none of it is
// open to web pages (protocol.ts refuses all three). The background takes
// the workspace from the tab it opened the page in, never from a message.

/** The runtime port the config page connects on. */
export const CONFIG_PORT_NAME = 'language-check-config';

/** Largest config the native host reads or writes, in UTF-8 bytes (Config::MAX_TEXT_BYTES in rust-core/src/config.rs). */
export const MAX_CONFIG_TEXT_BYTES = 256 * 1024;

export type ConfigRequest =
    | { readonly readConfig: Record<string, never> }
    | { readonly writeConfig: { readonly text: string } }
    | { readonly probeConfig: { readonly text: string; readonly format: 'yaml' | 'json' } };

export interface ConfigPageRequest {
    readonly id: number;
    readonly request: ConfigRequest;
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const utf8 = new TextEncoder();
const isConfigText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_CONFIG_TEXT_BYTES && utf8.encode(v).length <= MAX_CONFIG_TEXT_BYTES;

/** Parses a config page message, or `undefined` when it is not exactly one known request within bounds. */
export function parseConfigPageRequest(value: unknown): ConfigPageRequest | undefined {
    if (!isBag(value) || !Number.isSafeInteger(value.id) || (value.id as number) <= 0 || !isBag(value.request)) return undefined;
    const keys = Object.keys(value.request);
    if (keys.length !== 1) return undefined;
    const [kind] = keys;
    const body = value.request[kind ?? ''];
    if (!isBag(body)) return undefined;
    const id = value.id as number;
    switch (kind) {
        case 'readConfig':
            return { id, request: { readConfig: {} } };
        case 'writeConfig':
            return isConfigText(body.text) ? { id, request: { writeConfig: { text: body.text } } } : undefined;
        case 'probeConfig':
            return isConfigText(body.text) && (body.format === 'yaml' || body.format === 'json')
                ? { id, request: { probeConfig: { text: body.text, format: body.format } } }
                : undefined;
        default:
            return undefined;
    }
}
