/**
 * Where a config key lives in the buffer.
 *
 * The core answers about keys by dotted path, because it works from a parsed
 * config and serde has thrown every byte offset away by the time it has one.
 * Mapping a path back to a range is therefore the editor's job, and it is
 * done against the text on screen so that a mark lands on the line the user
 * is looking at rather than on the line the same key occupied when the file
 * was last saved.
 *
 * The YAML is parsed a second time here to get those offsets. That is cheap
 * -- a config is a few dozen lines -- and it is the only way to squiggle a
 * value rather than the block around it.
 */
import { parseDocument, isMap, isSeq, isScalar, type Document, type Node } from 'yaml';

/** A byte range in the config text, half-open, as the `yaml` parser reports. */
export interface KeySpan {
    /** Offset of the key token itself, for the gutter mark and the hover. */
    readonly keyStart: number;
    readonly keyEnd: number;
    /** Offset of the value, for the squiggle. Equal to the key span when the
     *  key has no value of its own to point at. */
    readonly valueStart: number;
    readonly valueEnd: number;
}

/** A problem the YAML parser itself found, with where it found it. */
export interface SyntaxProblem {
    readonly message: string;
    readonly start: number;
    readonly end: number;
    /** A duplicate key is a warning; a document that will not parse is an error. */
    readonly fatal: boolean;
}

export interface ParsedConfig {
    /** Dotted path to span, for every key in the document. */
    readonly spans: ReadonlyMap<string, KeySpan>;
    readonly problems: readonly SyntaxProblem[];
    /** False when the document could not be parsed at all. */
    readonly parsed: boolean;
}

/**
 * A duplicate key is what the sample config in our own README invites.
 *
 * The file documents both `harper: true` and the nested `harper:` block, and
 * a reader who copies both gets a YAML map with the key twice. YAML takes the
 * last one, so the shorthand silently vanishes -- and because the document
 * still resolves, nothing downstream has any reason to mention it.
 *
 * The parser files it under `errors`, but it is not one in the sense that
 * matters here: the contents are intact and every other key still has a
 * position, so the document is walked as usual and this is reported on its
 * own.
 */
const RESOLVES_ANYWAY = new Set(['DUPLICATE_KEY']);

/**
 * The parser's own message, without the excerpt it appends.
 *
 * `yaml` follows the sentence with a blank line, the offending source lines
 * and a caret. That reads well in a terminal and badly in a hover, which is
 * already showing the line it points at.
 */
function firstSentence(message: string): string {
    const line = message.split('\n')[0] ?? message;
    return line.replace(/ at line \d+, column \d+:?$/, '');
}

export function parseConfigKeys(text: string): ParsedConfig {
    const spans = new Map<string, KeySpan>();
    const problems: SyntaxProblem[] = [];

    let document: Document.Parsed;
    try {
        document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true });
    } catch (error) {
        return {
            spans,
            parsed: false,
            problems: [{
                message: error instanceof Error ? error.message : String(error),
                start: 0,
                end: Math.min(text.length, 1),
                fatal: true,
            }],
        };
    }

    let fatal = false;
    for (const error of document.errors) {
        const resolves = RESOLVES_ANYWAY.has(error.code);
        if (!resolves) fatal = true;
        problems.push({
            message: resolves
                ? `${firstSentence(error.message)}. YAML keeps the last one, so the earlier block has no effect.`
                : firstSentence(error.message),
            start: error.pos[0],
            end: error.pos[1],
            fatal: !resolves,
        });
    }
    for (const warning of document.warnings) {
        problems.push({
            message: firstSentence(warning.message),
            start: warning.pos[0],
            end: warning.pos[1],
            fatal: false,
        });
    }

    if (fatal || document.contents === null) {
        return { spans, problems, parsed: !fatal };
    }

    walk(document.contents, [], spans);
    return { spans, problems, parsed: true };
}

/**
 * Record a span for every key, keyed by the dotted path the core uses.
 *
 * Sequence entries are indexed (`disabled_rules.0`), because that is the only
 * stable way to name one: a rule id is not unique within the list and a
 * position is.
 */
function walk(node: Node | null, path: readonly string[], out: Map<string, KeySpan>): void {
    if (isMap(node)) {
        for (const pair of node.items) {
            const key: unknown = pair.key;
            if (!isScalar(key)) continue;
            const keyRange = key.range ?? null;
            if (keyRange === null) continue;
            const name = String(key.value);
            const here = [...path, name];
            const [keyStart, keyEnd] = keyRange;
            const valueRange = (pair.value as Node | null)?.range ?? null;
            out.set(here.join('.'), {
                keyStart,
                keyEnd,
                valueStart: valueRange === null ? keyStart : valueRange[0],
                valueEnd: valueRange === null ? keyEnd : valueRange[1],
            });
            walk(pair.value as Node | null, here, out);
        }
        return;
    }

    if (isSeq(node)) {
        node.items.forEach((item, index) => {
            const entry = item as Node | null;
            const range = entry?.range ?? null;
            if (entry === null || range === null) return;
            const here = [...path, String(index)];
            out.set(here.join('.'), {
                keyStart: range[0],
                keyEnd: range[1],
                valueStart: range[0],
                valueEnd: range[1],
            });
            walk(entry, here, out);
        });
    }
}

/**
 * The span to mark for a key, falling back up the path when the key is absent.
 *
 * A probe about `engines.languagetool.url` has nowhere to go when the config
 * relies on the default and never writes the key. Reporting it against the
 * nearest ancestor that does exist puts the mark on `languagetool:`, which is
 * where the reader would look for it anyway; reporting nothing would drop the
 * finding entirely.
 */
export function spanForKey(
    spans: ReadonlyMap<string, KeySpan>,
    key: string,
): KeySpan | undefined {
    const parts = key.split('.');
    for (let end = parts.length; end > 0; end--) {
        const span = spans.get(parts.slice(0, end).join('.'));
        if (span !== undefined) return span;
    }
    return undefined;
}
