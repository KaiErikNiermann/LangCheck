/**
 * The edits the extension makes to `.languagecheck.yaml`, as text transforms.
 *
 * These work on the file as a string, not through a YAML parser, and that is
 * deliberate: a parse-and-dump round trip would drop the user's comments and
 * reorder their keys. The cost is that each edit only understands the layouts
 * it matches, and falls back to prepending a fresh block when it finds none.
 * Pure functions of the text, so they are unit-tested without an editor.
 */

/** The `languages.latex` lists the LaTeX hints write to. */
export type LatexList = 'skip_environments' | 'prose_environments' | 'skip_commands';

/**
 * Add `name` to one of the `languages.latex` lists.
 *
 * Inserts under the first existing `<list>:`, else under `latex:`, else under
 * `languages:`, else prepends the whole block.
 */
export function addLatexListEntry(content: string, list: LatexList, name: string): string {
    const listKey = new RegExp(`${list}:`);
    if (content.match(listKey)) {
        return content.replace(listKey, `${list}:\n      - ${name}`);
    } else if (content.match(/latex:/)) {
        return content.replace(/latex:/, `latex:\n    ${list}:\n      - ${name}`);
    } else if (content.match(/languages:/)) {
        return content.replace(/languages:/, `languages:\n  latex:\n    ${list}:\n      - ${name}`);
    }
    return `languages:\n  latex:\n    ${list}:\n      - ${name}\n${content}`;
}

/** The spell-check language the config names, `en-US` when it names none. */
export function spellLanguageOf(content: string): string {
    return content.match(/spell_language:\s*(\S+)/)?.[1] ?? 'en-US';
}

/** Set `engines.spell_language`, replacing an existing value or adding the key. */
export function setSpellLanguage(content: string, language: string): string {
    if (content.includes('spell_language:')) {
        return content.replace(/spell_language:\s*\S+/, `spell_language: ${language}`);
    } else if (content.includes('engines:')) {
        return content.replace(/engines:/, `engines:\n  spell_language: ${language}`);
    }
    return `engines:\n  spell_language: ${language}\n${content}`;
}

/**
 * Whether the config enables an engine.
 *
 * Reads both spellings, the nested `harper:\n  enabled: true` first and then
 * the `harper: true` shorthand, and falls back to `fallback` when neither is
 * there.
 */
export function engineEnabled(content: string, key: string, fallback: boolean): boolean {
    const nestedRe = new RegExp(`^\\s*${key}:\\s*\\n\\s+enabled:\\s*(true|false)`, 'm');
    const boolRe = new RegExp(`^\\s*${key}:\\s*(true|false)\\s*$`, 'm');
    const nested = content.match(nestedRe);
    if (nested) return nested[1] === 'true';
    const bool = content.match(boolRe);
    if (bool) return bool[1] === 'true';
    return fallback;
}

/**
 * Set one engine on or off, in whichever spelling the file already uses.
 *
 * A new key goes directly under `engines:`, so engines set in one pass land in
 * the reverse of the order they were set in.
 */
export function setEngineEnabled(content: string, key: string, enabled: boolean): string {
    const nestedRe = new RegExp(`(^\\s*${key}:\\s*\\n\\s+enabled:\\s*)(true|false)`, 'm');
    const boolRe = new RegExp(`(^\\s*${key}:\\s*)(true|false)(\\s*$)`, 'm');
    if (nestedRe.test(content)) {
        return content.replace(nestedRe, `$1${enabled}`);
    } else if (boolRe.test(content)) {
        return content.replace(boolRe, `$1${enabled}$3`);
    } else if (content.includes('engines:')) {
        return content.replace(/engines:/, `engines:\n  ${key}: ${enabled}`);
    }
    return `engines:\n  ${key}: ${enabled}\n${content}`;
}

/**
 * Turn a rule off under `rules:`, unless an entry for it is already there.
 *
 * `alreadyDeactivated` is reported so the caller can skip the write: repeated
 * clicks would otherwise pile up duplicate keys, which serde_yaml resolves by
 * silently keeping the last. It matches an existing `<ruleId>:` line at any
 * indent.
 */
export function deactivateRule(content: string, ruleId: string): { content: string; alreadyDeactivated: boolean } {
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alreadyDeactivated = new RegExp(`^\\s*${escapeRe(ruleId)}:\\s*$`, 'm').test(content);
    if (alreadyDeactivated) return { content, alreadyDeactivated };

    const ruleEntry = `  ${ruleId}:\n    severity: "off"`;
    const updated = /^rules:/m.test(content)
        ? content.replace(/^rules:/m, `rules:\n${ruleEntry}`)
        : `${content}\nrules:\n${ruleEntry}\n`;
    return { content: updated, alreadyDeactivated };
}
