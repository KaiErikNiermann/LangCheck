/**
 * Offering to install a dictionary pack, once.
 *
 * A language the checker cannot read is worth telling the user about, and
 * worth telling them once. A modal that returns every time a file is opened is
 * how a useful offer becomes something people disable, so "No" is remembered
 * for good — while the offer stays reachable as a quick fix on the squiggle,
 * which costs nothing until someone goes looking for it.
 */

import { ruleIdOf } from './diagnostics/diagnostic';

/** The subset of the extension host this module needs, so it can be tested. */
export interface PromptMemory {
    get<T>(key: string, fallback: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

/** A language the core says it could not check. */
export interface UncheckedLanguage {
    /** BCP-47 tag, as the core resolved it. Never parsed out of a message. */
    language: string;
    /** Whether a pack for it can actually be fetched. */
    installable: boolean;
}

const DECLINED_KEY = 'languageCheck.declinedPacks';

/** Tags declined by the user, which are never asked about again. */
export function declinedPacks(memory: PromptMemory): string[] {
    return memory.get<string[]>(DECLINED_KEY, []);
}

/** Remember that the user does not want this pack, permanently. */
export async function declinePack(memory: PromptMemory, language: string): Promise<void> {
    const tag = normalise(language);
    const declined = declinedPacks(memory);
    if (!declined.includes(tag)) {
        await memory.update(DECLINED_KEY, [...declined, tag]);
    }
}

/** Undo a decline, for the quick fix and for a command that resets them. */
export async function forgetDecline(memory: PromptMemory, language: string): Promise<void> {
    const tag = normalise(language);
    await memory.update(DECLINED_KEY, declinedPacks(memory).filter(d => d !== tag));
}

/**
 * Whether to raise the modal for this language.
 *
 * Every condition is a reason someone would rightly be annoyed by the popup:
 * a language with no download behind it, one they have already refused, one
 * already asked about this session, or a tag that is not a tag at all.
 */
export function shouldPrompt(
    memory: PromptMemory,
    asked: Set<string>,
    candidate: UncheckedLanguage,
): boolean {
    if (!candidate.installable) return false;
    if (!isLanguageTag(candidate.language)) return false;
    const tag = normalise(candidate.language);
    if (asked.has(tag)) return false;
    return !declinedPacks(memory).includes(tag);
}

/**
 * Whether a string is a language tag we will act on.
 *
 * Deliberately strict. The prompt is the most intrusive thing this feature
 * does, so it fires only on something shaped like `he`, `en-GB` or
 * `ca-ES-valencia` — never on a stray word that reached the field.
 */
export function isLanguageTag(value: string): boolean {
    return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/i.test(value);
}

/** Tags are compared case-insensitively and without their separator. */
function normalise(language: string): string {
    return language.replace(/_/g, '-').toLowerCase();
}

/** The languages a document reported as unchecked, deduplicated. */
export function uncheckedLanguages(
    diagnostics: readonly { code?: unknown; language?: string; packInstallable?: boolean }[],
): UncheckedLanguage[] {
    const seen = new Map<string, UncheckedLanguage>();
    for (const d of diagnostics) {
        const rule = ruleIdOf(d, '');
        if (rule !== 'languagecheck.no-provider') continue;
        const language = d.language ?? '';
        if (!language) continue;
        const tag = normalise(language);
        if (!seen.has(tag)) {
            seen.set(tag, { language, installable: d.packInstallable === true });
        }
    }
    return [...seen.values()];
}

/**
 * Languages LanguageTool ships, as its own `/v2/languages` reported them.
 *
 * Advisory only: it decides whether to *mention* LanguageTool alongside the
 * Hunspell offer, never whether to check anything. A list compiled here would
 * go stale against a server the user upgrades, so nothing depends on it being
 * right — the core asks the real server what it supports.
 *
 * Measured against LanguageTool 6.7.
 */
const LANGUAGETOOL_LANGUAGES = new Set([
    'ar', 'ast', 'be', 'br', 'ca', 'crh', 'da', 'de', 'el', 'en', 'eo', 'es',
    'fa', 'fr', 'ga', 'gl', 'it', 'ja', 'km', 'nl', 'pl', 'pt', 'ro', 'ru',
    'sk', 'sl', 'sv', 'ta', 'tl', 'uk', 'zh',
]);

/**
 * Whether LanguageTool would cover this language, were it running.
 *
 * Worth saying in the offer, because the two are not equivalent: Hunspell
 * gives spelling and nothing else, while LanguageTool adds grammar and style.
 * A user offered only the narrower one might reasonably have picked the other.
 */
export function languageToolCovers(language: string): boolean {
    if (!isLanguageTag(language)) return false;
    const primary = language.split(/[-_]/)[0]?.toLowerCase() ?? '';
    return LANGUAGETOOL_LANGUAGES.has(primary);
}
