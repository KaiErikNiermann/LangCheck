/**
 * Reading single values out of a `.languagecheck.*` file.
 *
 * The extension does not parse the whole config -- the core owns that -- but a
 * few keys govern the editor's own behaviour and have to be read here. Kept in
 * a module of its own so they are testable without a VS Code host.
 */

/**
 * How long after the last keystroke a check runs, when the config says nothing.
 *
 * Matches `performance.debounce_ms` in the core's default config; a
 * `.languagecheck.*` that sets it wins.
 */
export const DEFAULT_DEBOUNCE_MS = 500;

/** Read `performance.debounce_ms` out of a YAML config, if it sets one. */
export function parseDebounceMs(content: string): number {
    const match = content.match(/^\s*debounce_ms:\s*(\d+)\s*$/m);
    if (!match?.[1]) return DEFAULT_DEBOUNCE_MS;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DEBOUNCE_MS;
}

/**
 * Items of a YAML list, by the key that introduces it.
 *
 * Deliberately not a YAML parser: these keys govern editor behaviour that has
 * to be read on every keystroke, and the core owns the real parse. What it
 * does have to get right is quoting -- `- "words.txt"` and `- words.txt` are
 * the same path, and keeping the quotes meant the first was watched as a file
 * whose name began with a quote character. A wordlist written the quoted way,
 * which is how the schema reference writes it, was never watched at all.
 */
export function parseYamlList(content: string, key: string): Set<string> {
    const items = new Set<string>();
    const re = new RegExp(`${key}:\\s*\\n((?:\\s+-\\s+\\S+\\n?)*)`);
    const match = content.match(re);
    if (!match?.[1]) return items;
    for (const line of match[1].split('\n')) {
        const item = line.match(/^\s+-\s+(\S+)/);
        if (item?.[1]) items.add(unquote(item[1]));
    }
    return items;
}

/** Drop one matched pair of surrounding quotes, as YAML would. */
function unquote(value: string): string {
    const quoted = /^(["'])(.*)\1$/.exec(value);
    return quoted?.[2] ?? value;
}

/** `languages.latex.skip_environments`. */
export function parseSkipEnvironments(content: string): Set<string> {
    return parseYamlList(content, 'skip_environments');
}

/** `languages.latex.skip_commands`. */
export function parseSkipCommands(content: string): Set<string> {
    return parseYamlList(content, 'skip_commands');
}

/** `languages.latex.prose_environments`. */
export function parseProseEnvironments(content: string): Set<string> {
    return parseYamlList(content, 'prose_environments');
}

/**
 * `dictionaries.paths`.
 *
 * The key is nested, and [`parseYamlList`] matches on the key alone, which is
 * enough here: no other `paths:` key exists in the schema.
 */
export function parseDictionaryPaths(content: string): Set<string> {
    return parseYamlList(content, 'paths');
}

/**
 * The words a wordlist file accepts.
 *
 * Matches the core's own reader: one word per line, `#` starts a comment, and
 * everything is folded to lower case because that is how the dictionary is
 * looked up.
 */
export function parseWordlist(content: string): Set<string> {
    const words = new Set<string>();
    for (const line of content.split('\n')) {
        const word = line.trim();
        if (word === '' || word.startsWith('#')) continue;
        words.add(word.toLowerCase());
    }
    return words;
}

/**
 * The words `after` adds, or null when it also takes some away.
 *
 * Adding a word can only remove spelling findings -- the core applies the
 * dictionary as a suppression after the engines have run. Removing one is the
 * other direction: the finding was dropped inside the core and never reached
 * the editor, so only a real check brings it back.
 */
export function wordsAdded(before: string, after: string): Set<string> | null {
    const had = parseWordlist(before);
    const has = parseWordlist(after);
    for (const word of had) {
        if (!has.has(word)) return null;
    }
    const added = new Set<string>();
    for (const word of has) {
        if (!had.has(word)) added.add(word);
    }
    return added;
}
