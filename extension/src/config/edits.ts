/**
 * The edits the extension makes to `.languagecheck.yaml`, and the two values
 * it reads back out of it.
 *
 * These used to be regular expressions over the text, on the grounds that a
 * parse-and-dump round trip drops the user's comments and reorders their
 * keys. That holds for `parse` and `stringify`, not for the `yaml` library's
 * Document, which keeps comments, key order and each collection's style; and
 * the patterns did worse than reorder. They spliced a new entry in front of
 * a flow collection -- `rules: {}`, which `language-check config init`
 * writes, became `rules:` plus the entry plus ` {}`, and the core, unable to
 * read the file, fell back to its defaults. They edited a key named in a
 * comment, and assumed a two-space indent. The property test in
 * configEditsProperty.test.ts holds every edit to what the file means.
 *
 * New keys go first in their map, and a new `rules:` goes last in the file,
 * which is where the text edits put them. The file's line endings and
 * indentation are kept, and a `.languagecheck.json` is written back as JSON.
 * A file that does not parse is not edited at all: the edit throws, and the
 * command reports it, rather than guessing at what the text was meant to be.
 */
import YAML, { isMap, isScalar, Scalar, type Document, type YAMLMap } from 'yaml';

/** The `languages.latex` lists the LaTeX hints write to. */
export type LatexList = 'skip_environments' | 'prose_environments' | 'skip_commands';

/** A config being edited, and how to write it back the way it was written. */
interface Editing {
    readonly doc: Document;
    readonly root: YAMLMap;
    readonly crlf: boolean;
    readonly indent: number;
    readonly json: boolean;
}

function isJsonObject(content: string): boolean {
    try {
        const value: unknown = JSON.parse(content);
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    } catch {
        return false;
    }
}

/** The indent of the first nested line, which is what the file uses throughout. */
function indentOf(content: string): number {
    return /^[^\s#][^\n]*[:{[]\s*\r?\n( +)\S/m.exec(content)?.[1]?.length ?? 2;
}

function beginEdit(content: string): Editing {
    const doc: Document = YAML.parseDocument(content);
    const [error] = doc.errors;
    if (error) {
        throw new Error(`the config file is not valid YAML, so it was left as it is: ${error.message.split('\n')[0] ?? ''}`);
    }
    doc.contents ??= doc.createNode({});
    if (!isMap(doc.contents)) {
        throw new Error('the config file is not a map of settings, so it was left as it is');
    }
    return {
        doc,
        root: doc.contents,
        crlf: content.includes('\r\n'),
        indent: indentOf(content),
        json: isJsonObject(content),
    };
}

function finishEdit(edit: Editing, content: string): string {
    let out = edit.json
        ? `${JSON.stringify(edit.doc.toJS(), null, edit.indent)}${content.endsWith('\n') ? '\n' : ''}`
        : edit.doc.toString({ indent: edit.indent, lineWidth: 0 });
    if (edit.crlf) out = out.replace(/\r?\n/g, '\r\n');
    return out;
}

/** Put `key` first in `map`, or replace its value where it already is. */
function setFirst(doc: Document, map: YAMLMap, key: string, value: unknown): void {
    if (map.has(key)) {
        map.set(key, value);
    } else {
        map.items.unshift(doc.createPair(key, value));
    }
}

/**
 * The map at `path` under the root, made where it is missing -- first in its
 * parent -- or where something other than a map holds the key, such as the
 * empty value of a bare `engines:`.
 */
function mapAt(edit: Editing, path: readonly string[]): YAMLMap {
    let node = edit.root;
    for (const key of path) {
        const next = node.get(key, true);
        if (isMap(next)) {
            node = next;
            continue;
        }
        const created = edit.doc.createNode({}) as YAMLMap;
        // Inside a flow collection a block one cannot be written.
        created.flow = node.flow ?? false;
        setFirst(edit.doc, node, key, created);
        node = created;
    }
    return node;
}

/** What a config holds at `path`, as plain data; `parsed` is false when it does not parse. */
function readPath(content: string, path: readonly string[]): { parsed: false } | { parsed: true; value: unknown } {
    const doc = YAML.parseDocument(content);
    if (doc.errors.length > 0) return { parsed: false };
    let value: unknown = doc.toJS();
    for (const key of path) {
        value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
    }
    return { parsed: true, value };
}

/**
 * Add `name` to one of the `languages.latex` lists, first, creating the list
 * and the maps above it where they are missing.
 */
export function addLatexListEntry(content: string, list: LatexList, name: string): string {
    const edit = beginEdit(content);
    const latex = mapAt(edit, ['languages', 'latex']);
    const existing = latex.get(list, true);
    if (existing && YAML.isSeq(existing)) {
        existing.items.unshift(edit.doc.createNode(name));
    } else {
        const created = edit.doc.createNode([name]);
        created.flow = latex.flow ?? false;
        setFirst(edit.doc, latex, list, created);
    }
    return finishEdit(edit, content);
}

/**
 * The spell-check language the config names, `en-US` when it names none.
 *
 * A file that does not parse is one being typed, so it is read the old way,
 * by pattern, rather than showing the default while it is broken.
 */
export function spellLanguageOf(content: string): string {
    const read = readPath(content, ['engines', 'spell_language']);
    if (!read.parsed) return /spell_language:\s*(\S+)/.exec(content)?.[1] ?? 'en-US';
    return read.value === undefined || read.value === null ? 'en-US' : String(read.value);
}

/** Set `engines.spell_language`, in place, or first under `engines:`. */
export function setSpellLanguage(content: string, language: string): string {
    const edit = beginEdit(content);
    setFirst(edit.doc, mapAt(edit, ['engines']), 'spell_language', language);
    return finishEdit(edit, content);
}

/**
 * Whether the config enables an engine: the nested `vale:\n  enabled: true`
 * or the `vale: true` shorthand, and `fallback` when it says neither.
 */
export function engineEnabled(content: string, key: string, fallback: boolean): boolean {
    const read = readPath(content, ['engines', key]);
    if (!read.parsed) return fallback;
    if (typeof read.value === 'boolean') return read.value;
    const enabled = typeof read.value === 'object' && read.value !== null
        ? (read.value as { enabled?: unknown }).enabled
        : undefined;
    return typeof enabled === 'boolean' ? enabled : fallback;
}

/**
 * Set one engine on or off, in whichever spelling the file already uses, or
 * as the shorthand first under `engines:` when it names the engine not at
 * all. Engines set in one pass therefore land in the reverse of that order.
 */
export function setEngineEnabled(content: string, key: string, enabled: boolean): string {
    const edit = beginEdit(content);
    const engines = mapAt(edit, ['engines']);
    const current = engines.get(key, true);
    if (isMap(current)) {
        current.set('enabled', enabled);
    } else {
        setFirst(edit.doc, engines, key, enabled);
    }
    return finishEdit(edit, content);
}

/**
 * Turn a rule off under `rules:`.
 *
 * `alreadyDeactivated` is reported so the caller can skip the write when the
 * rule's severity is `off` already. An entry with some other severity is
 * switched off in place, where the text edit used to add a second key for
 * the same rule, which the core resolved by keeping whichever came last. A
 * new `rules:` block goes at the end of the file, after a blank line.
 */
export function deactivateRule(content: string, ruleId: string): { content: string; alreadyDeactivated: boolean } {
    const edit = beginEdit(content);
    const rules = edit.root.get('rules', true);
    const entry = isMap(rules) ? rules.get(ruleId, true) : undefined;
    if (isMap(entry) && String(entry.get('severity') ?? '').toLowerCase() === 'off') {
        return { content, alreadyDeactivated: true };
    }

    const off = new Scalar('off');
    off.type = Scalar.QUOTE_DOUBLE;
    if (isMap(entry)) {
        entry.set('severity', off);
    } else if (isMap(rules)) {
        const created = edit.doc.createNode({ severity: off }) as YAMLMap;
        created.flow = rules.flow ?? false;
        setFirst(edit.doc, rules, ruleId, created);
    } else {
        const block = edit.doc.createNode({ [ruleId]: { severity: off } }) as YAMLMap;
        block.flow = edit.root.flow ?? false;
        const pair = edit.doc.createPair('rules', block);
        if (edit.root.items.length > 0 && isScalar(pair.key)) pair.key.spaceBefore = true;
        if (edit.root.has('rules')) edit.root.delete('rules');
        edit.root.items.push(pair);
    }
    return { content: finishEdit(edit, content), alreadyDeactivated: false };
}
