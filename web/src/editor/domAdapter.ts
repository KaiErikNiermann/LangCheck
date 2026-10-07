// An EditorAdapter for block editors built on plain contenteditable leaves
// (Notion). Nothing is drawn by hand and nothing inside the editor is
// mutated:
//
// - Findings are painted with the CSS Custom Highlight API: live DOM Ranges
//   in a `Highlight`, styled with `::highlight()`. The browser lays them out,
//   wraps and scrolls them, and maps them through the editor's own edits
//   (a range over replaced text collapses, so a stale finding disappears
//   rather than pointing at the wrong words).
// - Hover is hit-tested with caretPositionFromPoint and the finding's own
//   client rects; the card is the shared CardController/Popover.
// - A fix selects the finding's range and runs execCommand('insertText'),
//   which reaches the editor as trusted input, like typing.
// - Changes are seen with a MutationObserver on the editor's root.
//
// The site supplies only which leaves hold prose and which inline elements
// are atoms (domText.ts).
import { MAX_CHECK_TEXT_CHARS } from '../messaging/protocol';
import { CardController, cardMembers, type Finding } from './card';
import { buildTextMap, leafAt, offsetOf, pointOf, rangeOf, type TextMap } from './domText';
import type { AttachedEditor } from './handle';
import { Popover, type PopoverSurface } from './popover';
import { CARD_DARK_RULES, CARD_RULES, SEVERITY_CLASS, SEVERITY_COLOR, toCss } from './styles';
import type { EditorAdapter, RenderedDiagnostic, TextEdit } from './types';

/** Findings painted at once; past this, the rest wait for the user to fix some. */
const MAX_RENDERED = 2000;
/** The card and toast sit above the editor's own overlays. */
const TOP_LAYER_Z = '2147483000';

export interface DomEditorRules {
    /** The prose leaves under `root`, in document order. */
    readonly leaves: (root: Element) => Iterable<Element>;
    /** Inline elements to read as one placeholder character (equations, inline code). */
    readonly isAtom: (element: Element) => boolean;
    /** A selector matching an ancestor when the site shows its dark theme. */
    readonly darkSelector?: string;
}

/** Whether this browser can paint findings without touching the DOM (Firefox 140+, Chrome 105+, Safari 17.2+). */
export function highlightsSupported(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

interface Painted {
    readonly range: Range;
    readonly diagnostic: RenderedDiagnostic;
}

export function createDomAdapter(root: Element, rules: DomEditorRules, uri: string, languageId: string): AttachedEditor {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let map: TextMap = buildTextMap(rules.leaves(root), rules.isAtom, MAX_CHECK_TEXT_CHARS);
    let dirty = false;
    let painted: Painted[] = [];
    /** The findings last published; their offsets hold for as long as the text is unchanged. */
    let published: readonly RenderedDiagnostic[] = [];
    let disposed = false;
    const changeListeners: (() => void)[] = [];

    /** The map as the DOM is now: a rebuild still queued from a mutation runs first. */
    const current = (): TextMap => {
        if (dirty) {
            dirty = false;
            map = buildTextMap(rules.leaves(root), rules.isAtom, MAX_CHECK_TEXT_CHARS);
        }
        return map;
    };

    const findingAt = (pos: number): Finding | undefined => {
        const now = current();
        for (const { range, diagnostic } of painted) {
            if (range.collapsed || !range.startContainer.isConnected) continue;
            const from = offsetOf(now, range.startContainer, range.startOffset);
            const to = offsetOf(now, range.endContainer, range.endOffset);
            if (from !== undefined && to !== undefined && from <= pos && pos < to) return { ...diagnostic, from, to };
        }
        return undefined;
    };

    const toastHost = document.createElement('div');
    toastHost.className = 'lc-toast-host';
    document.body.append(toastHost);
    const style = document.createElement('style');
    style.textContent = stylesheet(rules.darkSelector);
    document.head.append(style);

    const surface: PopoverSurface = {
        mount: document.body,
        toastMount: toastHost,
        place(at) {
            const now = current();
            const range = rangeOf(now, at, at + 1) ?? collapsedAt(now, at);
            const rect = range?.getBoundingClientRect();
            if (rect === undefined || (rect.width === 0 && rect.height === 0)) return null;
            return { top: rect.bottom + window.scrollY + 2, left: rect.left + window.scrollX };
        },
        measure(read, write) {
            requestAnimationFrame(() => {
                write(read());
            });
        },
        focusEditor() {
            const leaf = selectionLeaf();
            if (leaf instanceof HTMLElement) leaf.focus();
        },
    };

    const card = new CardController({
        findingAt,
        // No hover providers run here, so no word is ever a target.
        wordAt: noWord,
        popover: new Popover(surface),
    });

    const selectionLeaf = (): Element | undefined => {
        const selection = document.getSelection();
        const node = selection?.anchorNode;
        if (node === null || node === undefined) return undefined;
        const offset = offsetOf(current(), node, selection?.anchorOffset ?? 0);
        return offset === undefined ? undefined : leafAt(current(), offset);
    };

    /** The finding under the pointer: the caret position there, confirmed against the finding's own boxes. */
    const findingUnder = (x: number, y: number): number | undefined => {
        const caret = caretFromPoint(x, y);
        if (caret === undefined) return undefined;
        const pos = offsetOf(current(), caret.node, caret.offset);
        if (pos === undefined) return undefined;
        const finding = findingAt(pos) ?? findingAt(pos - 1);
        if (finding === undefined) return undefined;
        const range = rangeOf(current(), finding.from, finding.to);
        const inside = [...(range?.getClientRects() ?? [])].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        return inside ? finding.from : undefined;
    };

    root.addEventListener(
        'mousemove',
        (event) => {
            const e = event as MouseEvent;
            if (card.popover.contains(e.target)) card.pointerOnCard();
            else card.pointerAt(findingUnder(e.clientX, e.clientY));
        },
        { signal, passive: true },
    );
    root.addEventListener(
        'keydown',
        (event) => {
            const e = event as KeyboardEvent;
            const handled =
                e.key === 'Escape'
                    ? card.escape()
                    : e.key === '.' && (e.ctrlKey || e.metaKey) && openAtSelection();
            if (!handled) return;
            e.preventDefault();
            e.stopPropagation();
        },
        { signal, capture: true },
    );
    // Escape closes a card that is showing wherever focus is: hovering does
    // not put focus in the editor, so its own key handler would not see it.
    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key === 'Escape' && card.popover.visible && card.escape()) event.stopPropagation();
        },
        { signal, capture: true },
    );
    // The card is placed in page coordinates; the editor scrolls its own
    // container, so any scroll closes it, as VS Code's hovers do.
    document.addEventListener(
        'scroll',
        () => {
            card.close();
        },
        { signal, capture: true, passive: true },
    );

    const openAtSelection = (): boolean => {
        const selection = document.getSelection();
        const node = selection?.anchorNode;
        if (node === null || node === undefined) return false;
        const pos = offsetOf(current(), node, selection?.anchorOffset ?? 0);
        return pos !== undefined && card.openAtCursor(pos);
    };

    const observer = new MutationObserver(() => {
        if (dirty || disposed) return;
        dirty = true;
        // Coalesce a burst of mutations (one keystroke can be several) into
        // one rebuild and one change notification.
        queueMicrotask(() => {
            if (!dirty || disposed) return;
            const before = map.text;
            current();
            if (map.text === before) {
                // Same text, new nodes (a re-mount, a remote sync): the old
                // ranges collapsed, but the published offsets still hold.
                if (painted.some((p) => p.range.collapsed || !p.range.startContainer.isConnected)) repaint();
                return;
            }
            card.edited();
            for (const listener of changeListeners) listener();
        });
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });

    /** Ranges for the published findings over the current DOM, painted. */
    const repaint = (): void => {
        const now = current();
        painted = [];
        for (const diagnostic of published) {
            const range = rangeOf(now, diagnostic.from, diagnostic.to);
            if (range !== undefined) painted.push({ range, diagnostic });
        }
        paint();
    };

    const paint = (): void => {
        for (const [severity, name] of SEVERITY_CLASS.entries()) {
            const ranges = painted.filter((p) => p.diagnostic.severity === severity).map((p) => p.range);
            CSS.highlights.set(name, new Highlight(...ranges));
        }
    };

    const adapter: EditorAdapter = {
        uri,
        languageId,
        getText: () => current().text,
        onDidChange: (listener) => {
            changeListeners.push(listener);
        },
        renderDiagnostics: (diagnostics) => {
            if (disposed) return;
            published = diagnostics.slice(0, MAX_RENDERED);
            repaint();
            card.republished();
        },
        // Highlights style existing text; they cannot add ghost text. The card
        // shows the suggestion instead.
        renderHints: () => {},
        applyEdits: (edits: readonly TextEdit[]) => {
            if (disposed) return;
            // One span per fix is all the checker offers; several would each
            // have to be re-mapped after the editor re-renders the first.
            const [edit, ...rest] = edits;
            if (edit === undefined) return;
            if (rest.length > 0) throw new Error('this editor applies one edit at a time');
            applyEdit(current(), edit);
        },
        select: (from, to) => {
            if (disposed) return;
            const now = current();
            const range = rangeOf(now, from, to) ?? collapsedAt(now, from);
            const selection = document.getSelection();
            if (range === undefined || selection === null) return;
            selection.removeAllRanges();
            selection.addRange(range);
            range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
        },
        ...cardMembers(card),
    };

    return {
        adapter,
        isInstalled: () => !disposed && root.isConnected,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
            lifetime.abort();
            card.dispose();
            for (const name of SEVERITY_CLASS) CSS.highlights.delete(name);
            style.remove();
            toastHost.remove();
            changeListeners.length = 0;
        },
    };
}

/** Selects the edit's span in its leaf and replaces it as typed input. */
function applyEdit(map: TextMap, edit: TextEdit): void {
    if (edit.from < 0 || edit.to < edit.from || edit.to > map.text.length) throw new RangeError('edit outside the document');
    const leaf = leafAt(map, edit.from);
    const range = edit.to > edit.from ? rangeOf(map, edit.from, edit.to) : collapsedAt(map, edit.from);
    if (leaf === undefined || range === undefined || !(leaf instanceof HTMLElement) || leafAt(map, edit.to) !== leaf) {
        throw new Error('the fix spans text this editor cannot select');
    }
    leaf.focus();
    const selection = document.getSelection();
    if (selection === null) throw new Error('no selection to apply the fix through');
    selection.removeAllRanges();
    selection.addRange(range);
    // execCommand is deprecated but is the one way to produce trusted input
    // events, which is what the editor listens to; a refusal is reported.
    // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
    const ok = edit.insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.insert);
    if (!ok) throw new Error('the editor refused the fix');
}

function collapsedAt(map: TextMap, pos: number): Range | undefined {
    const point = pointOf(map, pos);
    if (point === undefined) return undefined;
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    return range;
}

/** The caret position under a point (Firefox 20+, Chrome 128+, Safari 17.4+). */
function caretFromPoint(x: number, y: number): { node: Node; offset: number } | undefined {
    const position = document.caretPositionFromPoint(x, y);
    return position === null ? undefined : { node: position.offsetNode, offset: position.offset };
}

function noWord(): undefined {
    return;
}

function stylesheet(darkSelector: string | undefined): string {
    const highlights = SEVERITY_CLASS.map(
        (name, i) => `::highlight(${name}) { text-decoration: underline wavy ${SEVERITY_COLOR[i] ?? 'steelblue'}; text-decoration-skip-ink: none; text-underline-offset: 3px; }`,
    );
    return [
        ...highlights,
        toCss(CARD_RULES),
        darkSelector === undefined ? '' : toCss(CARD_DARK_RULES, `${darkSelector} `),
        `body > .lc-popover { z-index: ${TOP_LAYER_Z}; }`,
        `.lc-toast-host { position: fixed; inset-block-end: 16px; inset-inline-end: 16px; z-index: ${TOP_LAYER_Z}; }`,
    ].join('\n');
}
