// Messages between the content script and the background, over a runtime
// port. The background re-parses the page request (defence in depth) and
// takes the workspace from the port's sender URL, never from the message.
import { parsePageRequest, type PageRequest, type PageResponse } from './protocol';

export const BACKGROUND_PORT_NAME = 'language-check';

export interface BackgroundRequest {
    readonly id: number;
    readonly request: PageRequest;
}

export interface BackgroundResponse {
    readonly id: number;
    readonly response: PageResponse;
}

export function parseBackgroundRequest(value: unknown): BackgroundRequest | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const { id, request } = value as Record<string, unknown>;
    if (!Number.isSafeInteger(id)) return undefined;
    const parsed = parsePageRequest(request);
    return parsed === undefined ? undefined : { id: id as number, request: parsed };
}
