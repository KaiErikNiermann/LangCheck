// Messages between the content script and the background, over a runtime
// port. The background re-parses the page request (defence in depth: a
// compromised content script is not the only way to reach this port) and
// re-checks the key.
import { parsePageRequest, type PageRequest, type PageResponse } from './protocol';

export const BACKGROUND_PORT_NAME = 'language-check';

export interface BackgroundRequest {
    readonly id: number;
    /** The workspace the content script derived from the tab's URL. */
    readonly key: string;
    readonly request: PageRequest;
}

export interface BackgroundResponse {
    readonly id: number;
    readonly response: PageResponse;
}

/** Same rule as `WorkspaceKey` in the native host: 1-128 of [A-Za-z0-9._-], not starting with '.'. */
const WORKSPACE_KEY = /^(?!\.)[A-Za-z0-9._-]{1,128}$/u;

export function parseBackgroundRequest(value: unknown): BackgroundRequest | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const { id, key, request } = value as Record<string, unknown>;
    if (typeof key !== 'string' || !Number.isSafeInteger(id) || !WORKSPACE_KEY.test(key)) return undefined;
    const parsed = parsePageRequest(request);
    return parsed === undefined ? undefined : { id: id as number, key, request: parsed };
}
