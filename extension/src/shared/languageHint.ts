/**
 * The ghost text shown after a language tag the core checks as another one.
 *
 * A bare `en` is checked as `en-US`, because LanguageTool accepts `en` and
 * then spell-checks none of it. Nothing on screen said so: the tag read `en`
 * and the spelling findings were simply there or not. The hint appends what
 * the author left out, so `lang: "en"` reads `en-US` at the place the
 * language was chosen.
 *
 * Returns `null` when there is nothing to show -- the tag was checked as
 * written, or one side is unknown.
 */
export function resolutionHint(declared: string, resolved: string): string | null {
    if (declared === '' || resolved === '') return null;
    const written = declared.toLowerCase();
    const checked = resolved.toLowerCase();
    if (written === checked) return null;
    // Resolution only ever adds a region, so the suffix is the whole story.
    // Anything else is shown in full rather than as a misleading tail.
    return checked.startsWith(written) ? resolved.slice(declared.length) : ` → ${resolved}`;
}
