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
export const PROTOCOL_VERSION = 1;

/** The `type` tag of the window message that hands the page its port. */
export const HANDSHAKE_TYPE = 'language-check:port';
/** The page's "I am loaded" announcement, answered with the port. */
export const PAGE_READY_TYPE = 'language-check:page-ready';

/** Largest text a check carries (the native host refuses more, too). */
export const MAX_CHECK_TEXT_CHARS = 2 * 1024 * 1024;
/** Words learned through add-to-dictionary: one token, not prose. */
export const MAX_WORD_CHARS = 100;
/** Requests from one page the content script holds before refusing more. */
export const MAX_IN_FLIGHT_PER_PAGE = 8;

/** Languages a web document can be checked as; the core resolves these ids. */
export const LANGUAGE_IDS = ['latex', 'typst', 'bibtex', 'markdown', 'plaintext'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export type PageRequest =
    | { readonly id: number; readonly op: 'check'; readonly text: string; readonly languageId: LanguageId }
    | { readonly id: number; readonly op: 'addWord'; readonly word: string }
    | {
          readonly id: number;
          readonly op: 'ignore';
          readonly message: string;
          readonly context: string;
          readonly text: string;
          readonly startByte: number;
          readonly endByte: number;
      };

/** A finding as the page receives it: the protobuf Diagnostic as plain data. */
export interface WireDiagnostic {
    readonly startByte: number;
    readonly endByte: number;
    readonly message: string;
    readonly severity: number;
    readonly ruleId: string;
    readonly unifiedId: string;
    readonly suggestions: readonly string[];
    readonly confidence: number;
}

export type PageResponse =
    | { readonly id: number; readonly ok: true; readonly diagnostics?: readonly WireDiagnostic[] }
    | { readonly id: number; readonly ok: false; readonly error: string; readonly code: ErrorCode };

/**
 * Why a request failed, as far as the page needs to tell apart:
 * `unavailable` means the native host is not installed or keeps dying,
 * which the page reports once instead of on every keystroke.
 */
export type ErrorCode = 'unavailable' | 'refused' | 'busy' | 'timeout' | 'failed';

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
 * not one. Strict: unknown ops, missing or extra-typed fields, oversized
 * text, and words with whitespace, control or bidi characters are refused.
 */
export function parsePageRequest(value: unknown): PageRequest | undefined {
    if (!isBag(value) || !isId(value.id)) return undefined;
    const id = value.id;
    switch (value.op) {
        case 'check': {
            return isText(value.text, MAX_CHECK_TEXT_CHARS) && isLanguage(value.languageId)
                ? { id, op: 'check', text: value.text, languageId: value.languageId }
                : undefined;
        }
        case 'addWord': {
            return isText(value.word, MAX_WORD_CHARS) && value.word.length > 0 && !CONTROL_OR_SPACE.test(value.word)
                ? { id, op: 'addWord', word: value.word.normalize('NFC') }
                : undefined;
        }
        case 'ignore': {
            return isText(value.message, 10_000) &&
                isText(value.context, 10_000) &&
                isText(value.text, MAX_CHECK_TEXT_CHARS) &&
                isByte(value.startByte) &&
                isByte(value.endByte) &&
                value.startByte <= value.endByte
                ? {
                      id,
                      op: 'ignore',
                      message: value.message,
                      context: value.context,
                      text: value.text,
                      startByte: value.startByte,
                      endByte: value.endByte,
                  }
                : undefined;
        }
        default: {
            return undefined;
        }
    }
}

/** A command the user chose in the palette, sent by the content script for the page to run. */
export const COMMAND_TYPE = 'command';

/** Parses a response arriving in the page; anything malformed is dropped. */
export function parsePageResponse(value: unknown): PageResponse | undefined {
    if (!isBag(value) || !isId(value.id) || typeof value.ok !== 'boolean') return undefined;
    if (!value.ok) {
        return typeof value.error === 'string' && isErrorCode(value.code)
            ? { id: value.id, ok: false, error: value.error, code: value.code }
            : undefined;
    }
    if (value.diagnostics === undefined) return { id: value.id, ok: true };
    if (!Array.isArray(value.diagnostics)) return undefined;
    const diagnostics: WireDiagnostic[] = [];
    for (const d of value.diagnostics as unknown[]) {
        const parsed = parseWireDiagnostic(d);
        if (parsed === undefined) return undefined;
        diagnostics.push(parsed);
    }
    return { id: value.id, ok: true, diagnostics };
}

const ERROR_CODES: readonly ErrorCode[] = ['unavailable', 'refused', 'busy', 'timeout', 'failed'];
const isErrorCode = (v: unknown): v is ErrorCode => (ERROR_CODES as readonly unknown[]).includes(v);

function parseWireDiagnostic(d: unknown): WireDiagnostic | undefined {
    if (!isBag(d) || !isByte(d.startByte) || !isByte(d.endByte) || d.startByte > d.endByte) return undefined;
    if (typeof d.message !== 'string' || !Number.isSafeInteger(d.severity)) return undefined;
    if (!Array.isArray(d.suggestions) || (d.suggestions as unknown[]).some((s) => typeof s !== 'string')) return undefined;
    return {
        startByte: d.startByte,
        endByte: d.endByte,
        message: d.message,
        severity: d.severity as number,
        ruleId: typeof d.ruleId === 'string' ? d.ruleId : '',
        unifiedId: typeof d.unifiedId === 'string' ? d.unifiedId : '',
        suggestions: d.suggestions as string[],
        confidence: typeof d.confidence === 'number' && Number.isFinite(d.confidence) ? d.confidence : 0,
    };
}
