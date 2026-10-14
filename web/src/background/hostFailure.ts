// What the browser's words for a native host that would not start mean, and
// what to do about it. Browsers say little: Firefox reports a manifest whose
// binary is gone, or a host that exits at once, as "An unexpected error
// occurred". The sentences here are a closed set naming no path, so a web
// page may be shown them; the browser's own words go only to the extension's
// pages and console.

export type HostStartFailure = 'not-registered' | 'forbidden' | 'did-not-start';

const SENTENCE: Readonly<Record<HostStartFailure, string>> = {
    'not-registered': 'the browser has no LangCheck native host registered; run "language-check-native-host install --browser firefox" (or chrome)',
    forbidden: 'the registered LangCheck native host does not allow this extension; run "language-check-native-host install" again for this browser',
    'did-not-start': 'the browser could not start the LangCheck native host, or it stopped at once; run "language-check-native-host doctor" to see why',
};

/** Which failure `raw` (a browser's port error) is: Firefox's and Chrome's wordings. */
export function classifyHostFailure(raw: string): HostStartFailure {
    if (/no such native application|native messaging host not found/iu.test(raw)) return 'not-registered';
    if (/forbidden/iu.test(raw)) return 'forbidden';
    return 'did-not-start';
}

/** `page`: the fixed sentence; `detail`: it with the browser's words, for the extension's own pages. */
export function explainHostFailure(raw: string | undefined): { readonly page: string; readonly detail: string } {
    const page = SENTENCE[classifyHostFailure(raw ?? '')];
    return { page, detail: raw === undefined || raw === '' ? page : `${page} (the browser said: "${raw}")` };
}
