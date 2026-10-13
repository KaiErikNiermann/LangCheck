// A host page's own spellchecker, read from its CodeMirror editor
// (research/foreign-checkers.md). Typst's marks are stock @codemirror/lint
// diagnostics with `markClass: "misspelling"`, Overleaf's are mark
// decorations of its own with class `ol-cm-spelling-error`; both reach the
// view through the public `EditorView.decorations` facet as static sets that
// cover the whole document. So one reader serves every such checker: mark
// decorations whose class carries a token, described per site
// (ForeignCheckerSpec), read with no internals.
//
// What it read can be stale: a checker answers a second or more after an
// edit, and until then its marks are only mapped through the edit (Typst's
// stays on a word that was just corrected). So every edit since a checker
// last answered is a dirty range, and a mark touching one is not reported.
// A checker answering is a change to its marks in a transaction that did not
// change the text; then the dirty ranges are cleared and listeners told.
import type { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type { ForeignCategory, ForeignFinding } from '../../../extension/src/checking/foreign';

type Bag = Readonly<Record<string, unknown>>;

/** One host checker, as a site describes it. */
export interface ForeignCheckerSpec {
    /** Its name in rule ids (`<checker>.<rule>`), and in `data-lc-absorb`. */
    readonly checker: string;
    readonly rule: string;
    readonly category: ForeignCategory;
    /** Matched as one whole token of a mark decoration's `class`. */
    readonly classToken: string;
    /** The language the mark says the word was read in, from its spec. */
    readonly language?: (spec: Bag) => unknown;
    /**
     * Rules that hide its marks and anything else it draws for them, scoped
     * under the editor while it is absorbed (`&[data-lc-absorb~="<checker>"]`
     * is prepended): a CodeMirror theme spec.
     */
    readonly hide: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const isObject = (v: unknown): v is Bag => typeof v === 'object' && v !== null;
const isSet = (v: unknown): v is DecorationSet => isObject(v) && typeof v.between === 'function';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The decoration sets in `state` a reader can see whole: view plugins' are functions of the viewport, and skipped. */
function staticSets(state: EditorState, Ev: typeof EditorView): DecorationSet[] {
    return state.facet(Ev.decorations).filter(isSet);
}

/** A lint mark carries its diagnostics (`diagnostics` since @codemirror/lint 6.8, `diagnostic` before). */
function lintDiagnostic(spec: Bag): Bag | undefined {
    const list = spec.diagnostics;
    if (Array.isArray(list) && isObject(list[0])) return list[0];
    return isObject(spec.diagnostic) ? spec.diagnostic : undefined;
}

/** BCP 47 from what a checker wrote (`en_US`, `de-DE`, `en`); empty when it wrote nothing usable. */
export function normalizeLanguage(value: unknown): string {
    const tag = str(value).trim().replaceAll('_', '-');
    const [primary, ...rest] = tag.split('-');
    const sound = primary !== undefined && /^[A-Za-z]{2,3}$/u.test(primary) && rest.every((part) => /^[A-Za-z0-9]{1,8}$/u.test(part));
    return sound ? tag : '';
}

/** Merged, sorted ranges; touching ones join. */
function compact(ranges: readonly (readonly [number, number])[]): [number, number][] {
    const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    for (const [from, to] of sorted) {
        const last = out.at(-1);
        if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
        else out.push([from, to]);
    }
    return out;
}

export class ForeignMarks {
    /** Whether a set holds any mark of ours to read; sets are immutable, so once per set. */
    private readonly matches = new WeakMap<DecorationSet, boolean>();
    /** Text changed since the checkers last answered, in current offsets. */
    private dirty: [number, number][] = [];
    private readonly listeners: (() => void)[] = [];

    constructor(
        private readonly specs: readonly ForeignCheckerSpec[],
        private readonly Ev: typeof EditorView,
    ) {}

    /** Whose mark a decoration spec is: by `class`, or `attributes.class` (how older @codemirror/lint set it). */
    private specFor(spec: Bag): ForeignCheckerSpec | undefined {
        const classValue = spec.class ?? (isObject(spec.attributes) ? spec.attributes.class : undefined);
        const tokens = new Set(str(classValue).split(/\s+/u));
        return this.specs.find((s) => tokens.has(s.classToken));
    }

    private holdsMarks(set: DecorationSet): boolean {
        let known = this.matches.get(set);
        if (known === undefined) {
            known = false;
            set.between(0, Number.MAX_SAFE_INTEGER, (_from, _to, deco) => {
                if (this.specFor(deco.spec as Bag) === undefined) return;
                known = true;
                return false;
            });
            this.matches.set(set, known);
        }
        return known;
    }

    /** The sets of `state` holding foreign marks. */
    private sources(state: EditorState): DecorationSet[] {
        return staticSets(state, this.Ev).filter((set) => this.holdsMarks(set));
    }

    /** Feed every update of the view: tracks edits, and notices a checker answering. */
    update(update: ViewUpdate): void {
        if (this.specs.length === 0) return;
        if (update.docChanged) {
            const { changes } = update;
            const next: [number, number][] = this.dirty.map(([from, to]) => [changes.mapPos(from, -1), changes.mapPos(to, 1)]);
            changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
                next.push([fromB, toB]);
            });
            this.dirty = compact(next);
            return;
        }
        // The sets holding marks, before and after, by identity: an answer
        // replaces one (or empties it, and it drops out); anything else
        // (a selection, our own findings landing) leaves them as they were.
        const before = this.sources(update.startState);
        const after = this.sources(update.state);
        if (before.length === after.length && before.every((set, i) => set === after[i])) return;
        this.dirty = [];
        for (const listener of this.listeners) listener();
    }

    /** Called when a checker has answered (its marks are fresh). */
    onDidAnswer(listener: () => void): void {
        this.listeners.push(listener);
    }

    /** Every fresh foreign mark in `view`'s current text. */
    read(view: EditorView): ForeignFinding[] {
        const found = new Map<string, ForeignFinding>();
        const { doc } = view.state;
        for (const set of this.sources(view.state)) {
            set.between(0, doc.length, (from, to, deco) => {
                const spec = deco.spec as Bag;
                const owner = this.specFor(spec);
                if (owner === undefined || from >= to || this.dirty.some(([dFrom, dTo]) => from <= dTo && to >= dFrom)) return;
                const key = `${owner.checker}:${String(from)}:${String(to)}`;
                if (found.has(key)) return;
                found.set(key, {
                    checker: owner.checker,
                    rule: owner.rule,
                    category: owner.category,
                    from,
                    to,
                    message: str(lintDiagnostic(spec)?.message),
                    language: normalizeLanguage(owner.language?.(spec)),
                });
            });
        }
        return [...found.values()].toSorted((a, b) => a.from - b.from || a.to - b.to || a.checker.localeCompare(b.checker));
    }

    dispose(): void {
        this.listeners.length = 0;
    }
}

/** The theme spec hiding `specs`' marks while `data-lc-absorb` names them. */
export function absorbTheme(specs: readonly ForeignCheckerSpec[]): Record<string, Readonly<Record<string, string>>> {
    return Object.fromEntries(
        specs.flatMap((spec) => Object.entries(spec.hide).map(([selector, style]) => [`&[data-lc-absorb~="${spec.checker}"] ${selector}`, style])),
    );
}

/** Lint diagnostics' language, for checkers built on @codemirror/lint that put it in `payload` (Typst). */
export const lintPayloadLanguage = (spec: Bag): unknown => lintDiagnostic(spec)?.payload;
