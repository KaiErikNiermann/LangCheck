// What a web page is shown of the core's answers, where it differs from
// what the core said.
import type { PageResponse } from '../messaging/protocol';

/**
 * A config listing as a web page may see it: which config is in force (a
 * file name) and what it includes, without the files it selects and skips,
 * which in the browser are the native host's own workspace files, and
 * without the parser's own words on a config it could not read: those quote
 * the offending value (`invalid type: string "…"`), and a value can be an
 * API key. The config page, which may see the text, shows those.
 */
export const CONFIG_UNREADABLE = 'the config could not be read; open Edit Config to see why';

export function forPage(response: PageResponse): PageResponse {
    const listing = response.ok ? (response.response.listConfigFiles as Record<string, unknown> | undefined) : undefined;
    if (listing === undefined || !response.ok) return response;
    const loadError = typeof listing.loadError === 'string' && listing.loadError !== '' ? CONFIG_UNREADABLE : '';
    return { ...response, response: { ...response.response, listConfigFiles: { ...listing, selected: [], skipped: [], loadError } } };
}
