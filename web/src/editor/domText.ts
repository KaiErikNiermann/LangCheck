// The text of a block editor's leaves (Notion's contenteditable blocks), as
// one string the checker reads, with a map back to the DOM.
//
// - Leaves are joined by a blank line, so the checker sees block breaks.
// - Text nodes are read in document order. A leaf's `textContent` is not the
//   prose: an inline equation's atom carries KaTeX's hidden MathML text.
// - An atom (an element the editor marks `contenteditable="false"`, or one
//   the site excludes, like inline code) becomes one U+FFFC, which the core
//   skips without a finding. A `<br>` becomes a line break.
// - A block element inside a leaf (Gmail's body holds a `<div>` per line)
//   starts and ends a line, or its first word runs into the line before.
// - Offsets are UTF-16 code units, like everything else in the extension.
//
// Only text-node characters map to the DOM; separators, atoms and breaks
// have no node, and ranges snap past them.

export const ATOM = '\u{FFFC}';
export const LEAF_SEPARATOR = '\n\n';

interface NodeEntry {
    readonly node: Text;
    readonly start: number;
}

interface LeafEntry {
    readonly element: Element;
    readonly start: number;
    readonly end: number;
}

export interface TextMap {
    readonly text: string;
    /** Text nodes in document order with where each starts in `text`. */
    readonly nodes: readonly NodeEntry[];
    readonly leaves: readonly LeafEntry[];
    /** Leaves past `maxChars` were left out. */
    readonly truncated: boolean;
    readonly nodeStart: ReadonlyMap<Text, number>;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Elements that lay out as their own lines. */
const BLOCKS: ReadonlySet<string> = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'SECTION', 'ARTICLE', 'HR']);

/** Where a block element ends, in the walk's stack. */
const BLOCK_END = Symbol('block end');

export function buildTextMap(leaves: Iterable<Element>, isAtom: (element: Element) => boolean, maxChars: number): TextMap {
    const builder = new TextMapBuilder(isAtom);
    for (const leaf of leaves) {
        // A leaf is added whole or not at all, so no finding straddles the cut.
        if (builder.length + LEAF_SEPARATOR.length + textLength(leaf, isAtom) > maxChars) return builder.finish(true);
        builder.addLeaf(leaf);
    }
    return builder.finish(false);
}

class TextMapBuilder {
    private readonly parts: string[] = [];
    private readonly nodes: NodeEntry[] = [];
    private readonly leaves: LeafEntry[] = [];
    private readonly nodeStart = new Map<Text, number>();
    length = 0;

    constructor(private readonly isAtom: (element: Element) => boolean) {}

    addLeaf(leaf: Element): void {
        if (this.leaves.length > 0) this.emit(LEAF_SEPARATOR);
        const start = this.length;
        // Iterative, so a deeply nested leaf cannot overflow the stack.
        const stack: (Node | typeof BLOCK_END)[] = [...leaf.childNodes].toReversed();
        for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
            if (node === BLOCK_END) this.lineBreak(start);
            else if (node.nodeType === TEXT_NODE) this.addText(node as Text);
            else if (node.nodeType === ELEMENT_NODE) {
                const element = node as Element;
                if (element.tagName === 'BR') this.emit('\n');
                else if (this.isAtom(element)) this.emit(ATOM);
                else if (BLOCKS.has(element.tagName)) {
                    this.lineBreak(start);
                    stack.push(BLOCK_END, ...[...element.childNodes].toReversed());
                } else stack.push(...[...element.childNodes].toReversed());
            }
        }
        this.leaves.push({ element: leaf, start, end: this.length });
    }

    finish(truncated: boolean): TextMap {
        return { text: this.parts.join(''), nodes: this.nodes, leaves: this.leaves, truncated, nodeStart: this.nodeStart };
    }

    private addText(text: Text): void {
        if (text.data.length === 0) return;
        this.nodes.push({ node: text, start: this.length });
        this.nodeStart.set(text, this.length);
        this.emit(text.data);
    }

    private emit(text: string): void {
        this.parts.push(text);
        this.length += text.length;
    }

    /** A line break, unless the leaf has nothing yet or a line just ended. */
    private lineBreak(leafStart: number): void {
        if (this.length > leafStart && !this.parts.at(-1)?.endsWith('\n')) this.emit('\n');
    }
}

/** What a leaf would add, without building it, at most: for the size cap. */
function textLength(leaf: Element, isAtom: (element: Element) => boolean): number {
    let total = 0;
    const stack: Node[] = [...leaf.childNodes];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (node.nodeType === TEXT_NODE) total += (node as Text).data.length;
        else if (node.nodeType === ELEMENT_NODE) {
            const element = node as Element;
            if (element.tagName === 'BR' || isAtom(element)) total += 1;
            else {
                // A block adds at most a break before and one after.
                if (BLOCKS.has(element.tagName)) total += 2;
                stack.push(...element.childNodes);
            }
        }
    }
    return total;
}

/** The offset in `map.text` of a DOM point, when it is inside a mapped text node. */
export function offsetOf(map: TextMap, node: Node, offset: number): number | undefined {
    if (node.nodeType !== TEXT_NODE) return undefined;
    const start = map.nodeStart.get(node as Text);
    if (start === undefined) return undefined;
    return start + Math.max(0, Math.min(offset, (node as Text).data.length));
}

/** The last text node starting at or before `pos`. */
function nodeIndexAt(map: TextMap, pos: number): number {
    let lo = 0;
    let hi = map.nodes.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const entry = map.nodes[mid];
        if (entry === undefined) break;
        if (entry.start <= pos) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return found;
}

/** A DOM point for `pos`: inside a text node, or snapped forward (start) / back (end) past unmapped characters. */
function boundary(map: TextMap, pos: number, side: 'start' | 'end'): { node: Text; offset: number } | undefined {
    const index = nodeIndexAt(map, pos);
    const entry = map.nodes[index];
    if (entry !== undefined && pos <= entry.start + entry.node.data.length && (side === 'end' || pos < entry.start + entry.node.data.length)) {
        return { node: entry.node, offset: pos - entry.start };
    }
    if (side === 'start') {
        const next = map.nodes[index + 1];
        return next === undefined ? undefined : { node: next.node, offset: 0 };
    }
    return entry === undefined ? undefined : { node: entry.node, offset: entry.node.data.length };
}

/** A DOM Range for `[from, to)`, or undefined when it is empty after snapping or spans two leaves. */
export function rangeOf(map: TextMap, from: number, to: number): Range | undefined {
    if (!(from >= 0 && to > from && to <= map.text.length)) return undefined;
    const leaf = map.leaves.find((l) => l.start <= from && to <= l.end);
    if (leaf === undefined) return undefined;
    const start = boundary(map, from, 'start');
    const end = boundary(map, to, 'end');
    if (start === undefined || end === undefined) return undefined;
    if (!leaf.element.contains(start.node) || !leaf.element.contains(end.node)) return undefined;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? undefined : range;
}

/** The leaf element `pos` falls in, if any. */
export function leafAt(map: TextMap, pos: number): Element | undefined {
    return map.leaves.find((l) => l.start <= pos && pos <= l.end)?.element;
}

/** A DOM point for an insertion at `pos` (the end of the text node before it). */
export function pointOf(map: TextMap, pos: number): { node: Text; offset: number } | undefined {
    if (!(pos >= 0 && pos <= map.text.length)) return undefined;
    return boundary(map, pos, 'end');
}
