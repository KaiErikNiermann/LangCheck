// Messages between the three parts of the extension:
//
//   page world  ──MessagePort──▶  content script  ──runtime port──▶  background  ──native port──▶  host
//
// The page world shares its realm with the site's own scripts, so anything
// arriving from it is untrusted: the content script parses every message
// with `parsePageRequest` and passes on only what it accepts. The workspace
// a request lands in is never the page's to choose; the content script
// derives it from the tab's URL (see sites/).

/** Bumped on any incompatible change; the page and content script must agree. */
export const PROTOCOL_VERSION = 2;

/** The `type` tag of the window message that hands the page its port. */
export const HANDSHAKE_TYPE = 'language-check:port';
/** The page's "I am loaded" announcement, answered with the port. */
export const PAGE_READY_TYPE = 'language-check:page-ready';

/** Largest text a check carries, in UTF-16 units. */
export const MAX_CHECK_TEXT_CHARS = 2 * 1024 * 1024;
/** Largest text the native host checks, in UTF-8 bytes (`MAX_CHECK_TEXT_BYTES` in rust-core/src/native_host.rs). */
export const MAX_CHECK_TEXT_BYTES = 4 * 1024 * 1024;

const utf8 = new TextEncoder();

/** Whether `text` is within both caps: the page's (characters) and the host's (bytes). */
export function withinCheckLimits(text: string): boolean {
    if (text.length > MAX_CHECK_TEXT_CHARS) return false;
    // A UTF-16 unit is at most 3 UTF-8 bytes: only a long text needs counting.
    return text.length * 3 <= MAX_CHECK_TEXT_BYTES || utf8.encode(text).length <= MAX_CHECK_TEXT_BYTES;
}
/** Words learned through add-to-dictionary: one token, not prose. */
export const MAX_WORD_CHARS = 100;
/** Requests from one page the content script holds before refusing more. */
export const MAX_IN_FLIGHT_PER_PAGE = 8;

/** Languages a web document can be checked as; the core resolves these ids. */
export const LANGUAGE_IDS = ['latex', 'typst', 'bibtex', 'markdown', 'plaintext'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

/**
 * A request to the core, in the protobuf `Request` payload shape the client's
 * Checker sends (`{ checkProse: {...} }`), limited to what a web page may ask.
 */
export type CoreRequest =
    | { readonly checkProse: { readonly text: string; readonly languageId: LanguageId; readonly window?: { readonly startByte: number; readonly endByte: number } } }
    | { readonly addDictionaryWord: { readonly word: string } }
    | {
          readonly ignore: {
              readonly message: string;
              readonly context: string;
              readonly text: string;
              readonly startByte: number;
              readonly endByte: number;
          };
      }
    | { readonly getMetadata: Record<string, never> }
    /** Which config is in force (by file name: the host scrubs paths) and what it includes, for the Inspector's Config tab. */
    | { readonly listConfigFiles: Record<string, never> };

export interface PageRequest {
    readonly id: number;
    readonly request: CoreRequest;
}

/**
 * The core's protobuf `Response` as plain data (`Response.toObject`), or a
 * failure. A failure's text is one fixed sentence per code: the detail can
 * name local paths and stays in the extension's console.
 */
export type PageResponse =
    | { readonly id: number; readonly ok: true; readonly response: Readonly<Record<string, unknown>> }
    | { readonly id: number; readonly ok: false; readonly error: string; readonly code: ErrorCode };

/**
 * Why a request failed, as far as the page needs to tell apart:
 * `unavailable` means the native host is not installed or keeps dying,
 * which the page reports once instead of on every keystroke; `interrupted`
 * that the request was cut off on the way (the background restarted, the
 * page moved to another workspace), which is no fault to report: the page
 * checks again once it is reconnected.
 */
export type ErrorCode = 'unavailable' | 'interrupted' | 'refused' | 'busy' | 'timeout' | 'failed';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isByte = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 0xFF_FF_FF_FF;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isLanguage = (v: unknown): v is LanguageId => (LANGUAGE_IDS as readonly unknown[]).includes(v);
// Every whitespace character `\s` matches, C0/C1 controls, zero-width and
// bidi controls, as explicit, non-overlapping ranges (escapes, so no
// invisible character sits in the source). One character class: linear.
// eslint-disable-next-line no-control-regex, security/detect-unsafe-regex -- see above
const CONTROL_OR_SPACE = /[\u{0}-\u{20}\u{7F}-\u{A0}\u{1680}\u{2000}-\u{200F}\u{2028}-\u{202F}\u{205F}\u{2066}-\u{2069}\u{3000}\u{FEFF}]/u;

/**
 * Parses a message from the page into a request, or `undefined` when it is
 * not one. Strict: exactly one known payload, rebuilt from the fields it may
 * carry (so `filePath` and `settings`, which the client's Checker sends, are
 * dropped: a web page names no file), oversized text refused, and words with
 * whitespace, control or bidi characters refused.
 */
export function parsePageRequest(value: unknown): PageRequest | undefined {
    if (!isBag(value) || !isId(value.id) || !isBag(value.request)) return undefined;
    const keys = Object.keys(value.request);
    if (keys.length !== 1) return undefined;
    const request = parseCoreRequest(keys[0], value.request[keys[0] ?? '']);
    return request === undefined ? undefined : { id: value.id, request };
}

function parseCoreRequest(kind: string | undefined, body: unknown): CoreRequest | undefined {
    if (!isBag(body)) return undefined;
    switch (kind) {
        case 'checkProse':
            // Bytes too, not only characters: past the host's cap, the frame
            // would end the native connection every tab on the workspace shares.
        {
            if (typeof body.text !== 'string' || !withinCheckLimits(body.text) || !isLanguage(body.languageId)) return undefined;
            // A window of the text, when the page checks it a window at a time: two byte offsets, in order.
            const { window } = body;
            if (window === undefined || window === null) return { checkProse: { text: body.text, languageId: body.languageId } };
            if (!isBag(window) || !isByte(window.startByte) || !isByte(window.endByte) || window.startByte > window.endByte) return undefined;
            return { checkProse: { text: body.text, languageId: body.languageId, window: { startByte: window.startByte, endByte: window.endByte } } };
        }
        case 'addDictionaryWord':
            return isText(body.word, MAX_WORD_CHARS) && body.word.length > 0 && !CONTROL_OR_SPACE.test(body.word)
                ? { addDictionaryWord: { word: body.word.normalize('NFC') } }
                : undefined;
        case 'ignore': {
            const { message, context, text, startByte, endByte } = body;
            return typeof text === 'string' && isByte(startByte) && isByte(endByte) && startByte <= endByte && isText(message, 10_000) && isText(context, 10_000) && withinCheckLimits(text)
                ? { ignore: { message, context, text, startByte, endByte } }
                : undefined;
        }
        case 'getMetadata':
            return { getMetadata: {} };
        case 'listConfigFiles':
            return { listConfigFiles: {} };
        default:
            return undefined;
    }
}

/** A command the user chose in the palette, sent by the content script for the page to run. */
export const COMMAND_TYPE = 'command';
/** A page script stopping: its port can be let go (it counts toward the tab's live ports). */
export const BYE_TYPE = 'bye';
/** The workspace's config changed (the config page saved it): check again under it. */
export const RELOAD_TYPE = 'reload';
/** The user changed the checking settings on the options page (`settings`: CheckSettings). */
export const SETTINGS_TYPE = 'settings';

/** Where the options page keeps the checking settings (browser.storage.local). */
export const CHECK_SETTINGS_KEY = 'checkSettings';

/** The client's `languageCheck.check.*` settings the options page sets: see the extension's package.json. */
export interface CheckSettings {
    readonly progressive: boolean;
    readonly windowBytes: number;
    readonly maxBytes: number;
}

export const DEFAULT_CHECK_SETTINGS: CheckSettings = { progressive: false, windowBytes: 16 * 1024, maxBytes: 0 };

/** Bounds the options page offers (the client holds the window to the same). */
export const WINDOW_BYTES_RANGE = { min: 1024, max: 1024 * 1024 } as const;

/** `v` when it is a whole number in `[min, max]`. */
const wholeIn = (v: unknown, min: number, max: number): number | undefined => (Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined);

/** `value` as CheckSettings: each field that is not a sound value of its kind falls back to its default. */
export function parseCheckSettings(value: unknown): CheckSettings {
    const bag = isBag(value) ? value : {};
    return {
        progressive: typeof bag.progressive === 'boolean' ? bag.progressive : DEFAULT_CHECK_SETTINGS.progressive,
        windowBytes: wholeIn(bag.windowBytes, WINDOW_BYTES_RANGE.min, WINDOW_BYTES_RANGE.max) ?? DEFAULT_CHECK_SETTINGS.windowBytes,
        maxBytes: wholeIn(bag.maxBytes, 0, 0xFF_FF_FF_FF) ?? DEFAULT_CHECK_SETTINGS.maxBytes,
    };
}

/** Parses a response arriving in the page; anything malformed is dropped. */
export function parsePageResponse(value: unknown): PageResponse | undefined {
    if (!isBag(value) || !isId(value.id) || typeof value.ok !== 'boolean') return undefined;
    if (value.ok) return isBag(value.response) ? { id: value.id, ok: true, response: value.response } : undefined;
    return typeof value.error === 'string' && isErrorCode(value.code) ? { id: value.id, ok: false, error: value.error, code: value.code } : undefined;
}

const ERROR_CODES: readonly ErrorCode[] = ['unavailable', 'interrupted', 'refused', 'busy', 'timeout', 'failed'];
const isErrorCode = (v: unknown): v is ErrorCode => (ERROR_CODES as readonly unknown[]).includes(v);
