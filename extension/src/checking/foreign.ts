/**
 * Findings of checkers that are not ours: a host page's own spellchecker,
 * read by the web client from the page's editor. They go to the core with
 * the check of the text they were read against, and come back merged with
 * the engines' findings (rust-core/src/foreign.rs).
 */
import type { languagecheck } from '../proto/checker';
import { charToByteConverter, type CharOffset } from './offsets';

/** What a foreign finding is about. Only spelling so far: the core drops the rest. */
export type ForeignCategory = 'spelling';

/** One finding, in string offsets of the text the check reads. */
export interface ForeignFinding {
    /** Who found it (`typst`, `overleaf`); `<checker>.<rule>` is its rule id. */
    readonly checker: string;
    readonly rule: string;
    readonly category: ForeignCategory;
    readonly from: number;
    readonly to: number;
    /** What the checker said; empty for a bare mark. */
    readonly message: string;
    /** The language it read the word in (BCP 47); empty when unknown. */
    readonly language: string;
}

/** The wire enum's values; a type import keeps protobufjs out of the page bundle. */
const CATEGORY: Record<ForeignCategory, languagecheck.ForeignCategory> = { spelling: 1 };

/** `findings` as the core takes them: byte offsets of `text`. */
export function foreignToWire(findings: readonly ForeignFinding[], text: string): languagecheck.ForeignFinding.$Properties[] {
    if (findings.length === 0) return [];
    const toByte = charToByteConverter(text);
    return findings.map(f => ({
        checker: f.checker,
        rule: f.rule,
        category: CATEGORY[f.category],
        startByte: toByte(f.from as CharOffset),
        endByte: toByte(f.to as CharOffset),
        message: f.message,
        language: f.language,
    }));
}

/**
 * A key that differs when `findings` would answer differently: a check
 * already running over the same text and the same findings is joined, one
 * over other findings is not.
 */
export function foreignKey(findings: readonly ForeignFinding[]): string {
    return findings.map(f => `${f.checker}.${f.rule}@${String(f.from)}-${String(f.to)}:${f.language}`).join('|');
}
