// Plays the content script for the page-layer tests, in the page's realm:
// answers the page's announcement with a port and serves requests from a
// small deterministic "core". Tests steer it through `__stub` to hold a
// check (so the window between an edit and its recheck can be observed),
// or to fail requests the way an absent host does.
import { HANDSHAKE_TYPE, PAGE_READY_TYPE, PROTOCOL_VERSION, parsePageRequest, type PageResponse } from '../../src/messaging/protocol';

const MISSPELLINGS: ReadonlyMap<string, string> = new Map([
    ['recieve', 'receive'],
    ['teh', 'the'],
]);

const learned = new Set<string>();
const held: (() => void)[] = [];
const stub = { hold: false, unavailable: false, checks: 0 };

function findings(text: string): unknown[] {
    const encoder = new TextEncoder();
    const out: unknown[] = [];
    for (const match of text.matchAll(/\p{L}+/gu)) {
        const word = match[0];
        const fix = MISSPELLINGS.get(word.toLowerCase());
        if (fix === undefined || learned.has(word)) continue;
        // Byte offsets, as the core reports them.
        const startByte = encoder.encode(text.slice(0, match.index)).length;
        out.push({ startByte, endByte: startByte + encoder.encode(word).length, message: `Did you mean to spell \`${word}\` this way?`, severity: 2, ruleId: 'harper.Spelling', unifiedId: 'spelling', suggestions: [fix], confidence: 1, language: '', packInstallable: false });
    }
    return out;
}

/** A CheckResponse as Response.toObject gives it: findings, the extraction, engine health. */
function checkResponse(text: string, languageId: string): Record<string, unknown> {
    const bytes = new TextEncoder().encode(text).length;
    return {
        checkProse: {
            diagnostics: findings(text),
            extraction: { proseRanges: [{ startByte: 0, endByte: bytes, exclusions: [], language: 'en-US', declaredLanguage: '' }], names: [], syntax: languageId, maxRangeBytes: 0 },
            engineHealth: [{ name: 'harper', status: 'ok', consecutiveFailures: 0, lastError: '', lastSuccessEpochMs: 1 }],
            servedFromCache: false,
        },
    };
}

function answer(raw: unknown): PageResponse | undefined {
    const parsed = parsePageRequest(raw);
    if (parsed === undefined) return undefined;
    const { id, request } = parsed;
    if ('checkProse' in request) stub.checks++;
    if (stub.unavailable) return { id, ok: false, code: 'unavailable', error: 'the LangCheck native host is not installed or did not start' };
    if ('checkProse' in request) return { id, ok: true, response: checkResponse(request.checkProse.text, request.checkProse.languageId) };
    if ('addDictionaryWord' in request) learned.add(request.addDictionaryWord.word);
    return { id, ok: true, response: 'getMetadata' in request ? { getMetadata: { name: 'stub', version: '0', supportedLanguageIds: [] } } : { ok: {} } };
}

window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; version?: unknown } | null;
    if (event.origin !== location.origin || event.source !== window || data?.type !== PAGE_READY_TYPE || data.version !== PROTOCOL_VERSION) return;
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', (e: MessageEvent) => {
        const reply = (): void => {
            const response = answer(e.data);
            if (response !== undefined) channel.port1.postMessage(response);
        };
        if (stub.hold && 'checkProse' in ((e.data as { request?: object } | null)?.request ?? {})) held.push(reply);
        else reply();
    });
    channel.port1.start();
    window.postMessage({ type: HANDSHAKE_TYPE, version: PROTOCOL_VERSION }, location.origin, [channel.port2]);
});

Object.assign(globalThis, {
    __stub: Object.assign(stub, {
        release() {
            stub.hold = false;
            for (const reply of held.splice(0)) reply();
        },
    }),
});
