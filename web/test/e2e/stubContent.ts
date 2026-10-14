// Plays the content script for the page-layer tests, in the page's realm:
// answers the page's announcement with a port and serves requests from a
// small deterministic "core". Tests steer it through `__stub` to hold a
// check (so the window between an edit and its recheck can be observed),
// or to fail requests the way an absent host does. Foreign findings (a
// site's own spellchecker) join its answer as the core's merge does: one
// per span, the stub's own first, a learned word left out.
import { HANDSHAKE_TYPE, PAGE_READY_TYPE, PING_TYPE, PONG_TYPE, PROTOCOL_VERSION, parsePageRequest, type ForeignFindingWire, type PageResponse } from '../../src/messaging/protocol';

const MISSPELLINGS: ReadonlyMap<string, string> = new Map([
    ['recieve', 'receive'],
    ['teh', 'the'],
]);

const learned = new Set<string>();
const held: (() => void)[] = [];
// `gone`: answers nothing at all, not even a ping, as a content script whose
// extension was turned off under the page.
const stub = { hold: false, unavailable: false, gone: false, checks: 0, foreign: [] as readonly ForeignFindingWire[] };

/** A diagnostic as Response.toObject gives it, as far as the stub answers. */
interface StubDiagnostic {
    readonly startByte: number;
    readonly endByte: number;
    readonly message: string;
    readonly ruleId: string;
    readonly unifiedId: string;
    readonly suggestions: readonly string[];
}
const diagnostic = (d: StubDiagnostic) => ({ ...d, severity: 2, confidence: 1, language: '', packInstallable: false });

function findings(text: string, foreign: readonly ForeignFindingWire[]): StubDiagnostic[] {
    const encoder = new TextEncoder();
    const out: StubDiagnostic[] = [];
    for (const match of text.matchAll(/\p{L}+/gu)) {
        const word = match[0];
        const fix = MISSPELLINGS.get(word.toLowerCase());
        if (fix === undefined || learned.has(word)) continue;
        // Byte offsets, as the core reports them.
        const startByte = encoder.encode(text.slice(0, match.index)).length;
        out.push({ startByte, endByte: startByte + encoder.encode(word).length, message: `Did you mean to spell \`${word}\` this way?`, ruleId: 'harper.Spelling', unifiedId: 'spelling', suggestions: [fix] });
    }
    const bytes = encoder.encode(text);
    const decoder = new TextDecoder();
    for (const f of foreign) {
        const word = decoder.decode(bytes.slice(f.startByte, f.endByte));
        const seen = out.some((d) => d.startByte === f.startByte && d.endByte === f.endByte);
        if (seen || learned.has(word)) continue;
        // A bare mark gets the message the core gives it (foreign::message_of).
        const message = f.message === '' ? `Possible spelling mistake: "${word}" (${f.checker})` : f.message;
        out.push({ startByte: f.startByte, endByte: f.endByte, message, ruleId: `${f.checker}.${f.rule}`, unifiedId: 'spelling.typo', suggestions: [] });
    }
    return out.toSorted((a, b) => a.startByte - b.startByte);
}

/** A CheckResponse as Response.toObject gives it: findings, the extraction, engine health. */
function checkResponse(text: string, languageId: string, foreign: readonly ForeignFindingWire[]): Record<string, unknown> {
    const bytes = new TextEncoder().encode(text).length;
    return {
        checkProse: {
            diagnostics: findings(text, foreign).map((d) => diagnostic(d)),
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
    if ('checkProse' in request) {
        stub.foreign = request.checkProse.foreign ?? [];
        return { id, ok: true, response: checkResponse(request.checkProse.text, request.checkProse.languageId, stub.foreign) };
    }
    if ('addDictionaryWord' in request) learned.add(request.addDictionaryWord.word);
    return { id, ok: true, response: 'getMetadata' in request ? { getMetadata: { name: 'stub', version: '0', supportedLanguageIds: [] } } : { ok: {} } };
}

window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; version?: unknown } | null;
    if (event.origin !== location.origin || event.source !== window || data?.type !== PAGE_READY_TYPE || data.version !== PROTOCOL_VERSION) return;
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', (e: MessageEvent) => {
        if (stub.gone) return;
        if ((e.data as { type?: unknown } | null)?.type === PING_TYPE) {
            channel.port1.postMessage({ type: PONG_TYPE });
            return;
        }
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
