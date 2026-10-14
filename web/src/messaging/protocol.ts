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
/** One finding of the site's own checker, as the Checker sends it (rust-core/src/foreign.rs validates it again). */
export interface ForeignFindingWire {
    readonly checker: string;
    readonly rule: string;
    readonly category: number;
    readonly startByte: number;
    readonly endByte: number;
    readonly message: string;
    readonly language: string;
}

/**
 * UTF-8 bytes a request may spend on foreign findings, and on a site's
 * dictionary. The native host takes one browser message of at most 8 MiB,
 * and a request travels in it as base64: a 4 MiB text is 5.3 MiB of that,
 * so what rides with it must stay well under the rest, or the oversized
 * message ends the connection every tab on the workspace shares.
 */
export const EXTRAS_BUDGET_BYTES = 512 * 1024;
/** Bytes counted per foreign finding besides its strings: offsets, category, field tags. */
const FINDING_OVERHEAD_BYTES = 32;
/** A foreign message's length; the core cuts at this too (foreign::MAX_MESSAGE_LEN). */
const MAX_FOREIGN_MESSAGE_CHARS = 500;

const utf8Length = (text: string): number => utf8.encode(text).length;

/** The most entries of a site's dictionary sent on; the core keeps at most as many (`site_dictionary::MAX_WORDS`). */
export const MAX_SITE_DICTIONARY_WORDS = 10_000;
/** Longer than any word the core keeps (64 characters), so an over-long one reaches it to be counted as dropped. */
const MAX_SITE_DICTIONARY_ENTRY = 256;

/** The most foreign findings a check carries, as the core takes (`foreign::MAX_FINDINGS`). */
export const MAX_FOREIGN_FINDINGS = 10_000;

export type CoreRequest =
    | {
          readonly checkProse: {
              readonly text: string;
              readonly languageId: LanguageId;
              readonly window?: { readonly startByte: number; readonly endByte: number };
              readonly foreign?: ForeignFindingWire[];
          };
      }
    | { readonly addDictionaryWord: { readonly word: string } }
    /** The site's own dictionary, as read in the page (rust-core/src/site_dictionary.rs coerces it). */
    | { readonly siteDictionary: { readonly source: string; readonly words: string[] } }
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
/** A checker's or rule's name: what the core accepts in a rule id. */
const FOREIGN_NAME = /^[a-z0-9_-]{1,32}$/u;

/**
 * The well-formed entries of `value`, each rebuilt from its fields; the rest
 * dropped, not the check. At most MAX_FOREIGN_FINDINGS of them, within
 * EXTRAS_BUDGET_BYTES: past either, the rest are left out.
 */
function parseForeign(value: unknown): ForeignFindingWire[] {
    if (!Array.isArray(value)) return [];
    const kept: ForeignFindingWire[] = [];
    let spent = 0;
    for (const entry of value.slice(0, MAX_FOREIGN_FINDINGS) as unknown[]) {
        if (!isBag(entry)) continue;
        const { checker, rule, category, startByte, endByte, message, language } = entry;
        const sound =
            typeof checker === 'string' && FOREIGN_NAME.test(checker) &&
            typeof rule === 'string' && FOREIGN_NAME.test(rule) &&
            category === 1 &&
            isByte(startByte) && isByte(endByte) && startByte < endByte &&
            isText(message ?? '', 1000) &&
            isText(language ?? '', 35);
        if (!sound) continue;
        const finding = { checker, rule, category, startByte, endByte, message: ((message as string | undefined) ?? '').slice(0, MAX_FOREIGN_MESSAGE_CHARS), language: (language as string | undefined) ?? '' };
        spent += FINDING_OVERHEAD_BYTES + utf8Length(finding.checker + finding.rule + finding.message + finding.language);
        if (spent > EXTRAS_BUDGET_BYTES) break;
        kept.push(finding);
    }
    return kept;
}

/** A site's dictionary entries: strings of bounded length, as many as fit MAX_SITE_DICTIONARY_WORDS and EXTRAS_BUDGET_BYTES. */
function parseSiteWords(words: readonly unknown[]): string[] {
    const kept: string[] = [];
    let spent = 0;
    for (const word of words.slice(0, MAX_SITE_DICTIONARY_WORDS)) {
        if (!isText(word, MAX_SITE_DICTIONARY_ENTRY)) continue;
        spent += 4 + utf8Length(word);
        if (spent > EXTRAS_BUDGET_BYTES) break;
        kept.push(word);
    }
    return kept;
}
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
export function parsePageRequest(value: unknown, site?: string): PageRequest | undefined {
    if (!isBag(value) || !isId(value.id) || !isBag(value.request)) return undefined;
    const keys = Object.keys(value.request);
    if (keys.length !== 1) return undefined;
    const request = parseCoreRequest(keys[0], value.request[keys[0] ?? '']);
    // A page sends its own site's dictionary, never another's: `site` is the
    // content script's, which knows which site it was loaded for.
    if (site !== undefined && request !== undefined && 'siteDictionary' in request && request.siteDictionary.source !== site) return undefined;
    return request === undefined ? undefined : { id: value.id, request };
}

/** A check: its text within the limits, a language we know, and the window and foreign findings, each validated. */
function parseCheckProse(body: Bag): CoreRequest | undefined {
    // Bytes too, not only characters: past the host's cap, the frame
    // would end the native connection every tab on the workspace shares.
    if (typeof body.text !== 'string' || !withinCheckLimits(body.text) || !isLanguage(body.languageId)) return undefined;
    // What the site's own spellchecker found in the text (research/foreign-checkers.md).
    const foreign = parseForeign(body.foreign);
    const withForeign = foreign.length > 0 ? { foreign } : {};
    // A window of the text, when the page checks it a window at a time: two byte offsets, in order.
    const { window } = body;
    if (window === undefined || window === null) return { checkProse: { text: body.text, languageId: body.languageId, ...withForeign } };
    if (!isBag(window) || !isByte(window.startByte) || !isByte(window.endByte) || window.startByte > window.endByte) return undefined;
    return { checkProse: { text: body.text, languageId: body.languageId, window: { startByte: window.startByte, endByte: window.endByte }, ...withForeign } };
}

function parseCoreRequest(kind: string | undefined, body: unknown): CoreRequest | undefined {
    if (!isBag(body)) return undefined;
    switch (kind) {
        case 'checkProse':
            return parseCheckProse(body);
        case 'siteDictionary': {
            const { source, words } = body;
            if (typeof source !== 'string' || !FOREIGN_NAME.test(source) || !Array.isArray(words)) return undefined;
            // Entries as the site holds them: strings, bounded; the core decides which are words.
            return { siteDictionary: { source, words: parseSiteWords(words) } };
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
/** The page asks whether the content script is still there; it answers PONG_TYPE at once. */
export const PING_TYPE = 'ping';
export const PONG_TYPE = 'pong';

/**
 * What the page is told when the extension went away under it: reloaded
 * (Chrome leaves the old content script cut off), turned off or removed.
 * Only reloading the page brings it back.
 */
export const EXTENSION_GONE = 'LangCheck was reloaded, updated or turned off since this page opened; reload the page to check it again';

/** Whether `error` is the browser saying this script's extension is gone ("Extension context invalidated."). */
export function isExtensionGone(error: unknown): boolean {
    return /context invalidated/iu.test(error instanceof Error ? error.message : String(error));
}

/** Where the options page keeps the checking settings (browser.storage.local). */
export const CHECK_SETTINGS_KEY = 'checkSettings';

/**
 * What becomes of a site's own spellchecker (Overleaf's, Typst's) where it
 * marks the words we check: `merge` hides its marks and takes its findings
 * into ours (one mark per word, in our style, under our dictionary), `ours`
 * hides it and ignores it, `both` leaves it alone.
 */
export type ForeignMode = 'merge' | 'ours' | 'both';
export const FOREIGN_MODES: readonly ForeignMode[] = ['merge', 'ours', 'both'];

/** The client's `languageCheck.check.*` settings the options page sets (see the extension's package.json), and the web's own. */
export interface CheckSettings {
    readonly progressive: boolean;
    readonly windowBytes: number;
    readonly maxBytes: number;
    readonly foreignCheckers: ForeignMode;
}

export const DEFAULT_CHECK_SETTINGS: CheckSettings = { progressive: false, windowBytes: 16 * 1024, maxBytes: 0, foreignCheckers: 'merge' };

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
        foreignCheckers: (FOREIGN_MODES as readonly unknown[]).includes(bag.foreignCheckers) ? (bag.foreignCheckers as ForeignMode) : DEFAULT_CHECK_SETTINGS.foreignCheckers,
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
