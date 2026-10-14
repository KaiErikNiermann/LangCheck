// CodeMirror 6 adapter: the editor Overleaf and Typst run. Diagnostics
// become mark decorations in a StateField of our own (a sibling of any lint
// field the host page has), mapped through edits so they stay put until the
// next check lands. The card's behaviour is the shared CardController's;
// this file only feeds it CodeMirror's positions and events.
//
// Everything CodeMirror is reached through `kit`, never imported, so the same
// code runs against our own modules or a host page's (see cm6kit.ts).
import { editsHold } from './edits';
import type { Extension, Range as CmRange, StateEffectType, StateField, Text } from '@codemirror/state';
import type { Decoration as CmDecoration, DecorationSet, EditorView } from '@codemirror/view';
import { CardController, cardMembers, type Finding } from './card';
import type { Cm6Kit } from './cm6kit';
import { absorbTheme, ForeignMarks, type ForeignCheckerSpec } from './foreign';
import { Popover, type PopoverSurface } from './popover';
import { CM6_THEME, SEVERITY_CLASS } from './styles';
import type { EditorAdapter, RenderedDiagnostic, RenderedHint, TextEdit } from './types';

export interface Cm6Adapter {
    readonly adapter: EditorAdapter;
    readonly extension: Extension;
    /** Whether the view's current state still carries our extension (a setState or reconfigure can drop it). */
    isInstalled(): boolean;
    /** Removes the extension from the view, closes the popover, and stops change notifications. */
    dispose(): void;
}

/** The card inside `view.scrollDOM` (which CM6 makes `position: relative`), so it scrolls with the text. */
function cm6Surface(view: EditorView): PopoverSurface {
    return {
        mount: view.scrollDOM,
        toastMount: view.dom,
        place(at) {
            if (at > view.state.doc.length) return null;
            const coords = view.coordsAtPos(at);
            if (coords === null) return null;
            const box = view.scrollDOM.getBoundingClientRect();
            return { top: coords.bottom - box.top + view.scrollDOM.scrollTop, left: coords.left - box.left + view.scrollDOM.scrollLeft };
        },
        measure(read, write) {
            view.requestMeasure({ read, write });
        },
        focusEditor() {
            view.focus();
        },
    };
}

/**
 * The base theme, one per CodeMirror build on the page. CodeMirror mounts
 * each theme's style module into the document and never removes it, so a
 * theme built per attach added the whole stylesheet again on every file
 * switch (the e2e memory test caught it: 60 rules a switch, without end).
 */
const themes = new WeakMap<object, Extension>();

function themeFor(Ev: Cm6Kit['EditorView']): Extension {
    let theme = themes.get(Ev);
    if (theme === undefined) {
        theme = Ev.baseTheme(CM6_THEME);
        themes.set(Ev, theme);
    }
    return theme;
}

/** The theme hiding a site's foreign checkers, likewise one per CodeMirror build and site. */
const absorbThemes = new WeakMap<object, Map<string, Extension>>();

function absorbThemeFor(Ev: Cm6Kit['EditorView'], specs: readonly ForeignCheckerSpec[]): Extension {
    const key = specs.map((s) => s.checker).join(' ');
    const bySite = absorbThemes.get(Ev) ?? new Map<string, Extension>();
    absorbThemes.set(Ev, bySite);
    let theme = bySite.get(key);
    if (theme === undefined) {
        theme = Ev.baseTheme(absorbTheme(specs));
        bySite.set(key, theme);
    }
    return theme;
}

export function createCm6Adapter(view: EditorView, kit: Cm6Kit, uri: string, languageId: string, foreignSpecs: readonly ForeignCheckerSpec[] = []): Cm6Adapter {
    const { Compartment, Decoration, EditorView: Ev, StateEffect } = kit;
    const compartment = Compartment === undefined ? undefined : new Compartment();
    const diagnosticsEffect = StateEffect.define<readonly RenderedDiagnostic[]>();
    const hintsEffect = StateEffect.define<readonly RenderedHint[]>();
    const absorbEffect = StateEffect.define<boolean>();

    // The site's own spellcheckers (none on a site without one): read, and
    // hidden while absorbed, by naming them in `data-lc-absorb` on the editor.
    const foreign = new ForeignMarks(foreignSpecs, Ev);
    const absorbed = foreignSpecs.map((s) => s.checker).join(' ');
    const absorbField = kit.StateField.define<boolean>({
        create: () => false,
        update(hidden, tr) {
            for (const e of tr.effects) if (e.is(absorbEffect)) hidden = e.value;
            return hidden;
        },
        provide: (field) => Ev.editorAttributes.from(field, (hidden): Record<string, string> => (hidden ? { 'data-lc-absorb': absorbed } : {})),
    });

    // The marks are the only copy of where findings are: CM6 maps them
    // through every edit, and lookups read them back (findingAt), so a
    // hover between an edit and the next check sees where the text went,
    // not where it was.
    const diagnosticField = replacedDecorations(kit, diagnosticsEffect, (doc, list) =>
        // Findings are for the text the check saw; drop any that no longer
        // fit instead of letting RangeSet throw on them.
        list
            .filter((d) => d.from >= 0 && d.to > d.from && d.to <= doc.length)
            .map((d) => Decoration.mark({ class: `lc-diag ${SEVERITY_CLASS[d.severity]}`, lcDiagnostic: d }).range(d.from, d.to)),
    );

    // Inlay hints as a CSS pseudo-element on a one-character mark, not a
    // widget: WidgetType can only be found on a page that already shows a
    // widget, and marks need nothing beyond Decoration.
    const hintField = replacedDecorations(kit, hintsEffect, (doc, hints) => hintMarks(doc, hints, Decoration));

    const changeListeners: (() => void)[] = [];
    let disposed = false;

    /** The finding under `pos`, at its current (mapped) position. */
    const findingAt = (pos: number): Finding | undefined => {
        let hit: Finding | undefined;
        view.state.field(diagnosticField, false)?.between(pos, pos + 1, (from, to, deco) => {
            const diagnostic = (deco.spec as { lcDiagnostic?: RenderedDiagnostic }).lcDiagnostic;
            if (diagnostic === undefined || pos < from || pos >= to) return;
            hit = { ...diagnostic, from, to };
            return false;
        });
        return hit;
    };

    const card = new CardController({
        findingAt,
        wordAt: (pos) => {
            const word = view.state.wordAt(pos);
            return word === null ? undefined : { from: word.from, to: word.to };
        },
        popover: new Popover(cm6Surface(view)),
    });

    /**
     * The start of the finding whose mark is under the pointer, read from the
     * DOM. Coordinates are not enough: the mark's box includes the inlay hint
     * drawn after the word, and over that pseudo-element Firefox maps the
     * pointer to the word's end, which a half-open lookup does not count as
     * inside it.
     */
    const findingPosUnder = (node: EventTarget | null): number | undefined => {
        const element = node instanceof Element ? node.closest('.lc-diag') : null;
        if (element === null || !view.contentDOM.contains(element)) return undefined;
        try {
            return view.posAtDOM(element, 0);
        } catch {
            return undefined;
        }
    };

    /** Ctrl (Cmd) held: hints read as links, as VS Code shows an inlay hint's command. */
    const setModifier = (event: MouseEvent | KeyboardEvent): void => {
        const held = event.ctrlKey || event.metaKey;
        if (held === (view.dom.dataset.lcMod !== undefined)) return;
        if (held) view.dom.dataset.lcMod = '';
        else delete view.dom.dataset.lcMod;
    };

    /**
     * Ctrl+click (Cmd+click) on a hint's ghost text runs its command, as on
     * an inlay hint in VS Code. The ghost text is the hint mark's
     * pseudo-element, and only it takes the pointer (styles.ts): a click
     * that targets the mark is on the ghost text, wherever it was laid out,
     * on the line or wrapped below it. Returns whether the click was taken,
     * so CodeMirror does not also add a cursor there.
     */
    const onHintClick = (event: MouseEvent): boolean => {
        if (disposed || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const mark = event.target instanceof Element ? event.target.closest('.lc-hint-after, .lc-hint-before') : null;
        if (mark === null || !view.contentDOM.contains(mark)) return false;
        let at: number;
        try {
            at = view.posAtDOM(mark, 0);
        } catch {
            return false;
        }
        const run = hintsAt(at).find((hint) => hint.run !== undefined)?.run;
        if (run === undefined) return false;
        event.preventDefault();
        run();
        return true;
    };

    /** The hints drawn on the mark starting at `at`. */
    const hintsAt = (at: number): readonly RenderedHint[] => {
        let found: readonly RenderedHint[] = [];
        view.state.field(hintField, false)?.between(at, at + 2, (from, _to, deco) => {
            const hints = (deco.spec as { lcHints?: readonly RenderedHint[] }).lcHints;
            if (from !== at || hints === undefined) return;
            found = hints;
            return false;
        });
        return found;
    };

    const onPointer = (event: MouseEvent): void => {
        if (disposed) return;
        setModifier(event);
        if (card.popover.contains(event.target)) card.pointerOnCard();
        else card.pointerAt(findingPosUnder(event.target) ?? view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined);
    };

    const onKey = (event: KeyboardEvent): boolean => {
        if (event.key === 'Escape') return card.escape();
        if (event.key !== '.' || !(event.ctrlKey || event.metaKey)) return false;
        return card.openAtCursor(view.state.selection.main.head);
    };

    const parts: Extension = [
        // Order matters: a mark from an earlier field is drawn inside one from
        // a later field, so the one-character hint mark sits inside the
        // finding's mark instead of splitting it into two spans.
        hintField,
        diagnosticField,
        Ev.domEventHandlers({
            mousemove: (event) => {
                onPointer(event);
            },
            mouseleave: (event) => {
                if (!card.popover.contains(event.relatedTarget)) onPointer(event);
            },
            mousedown: (event) => onHintClick(event),
            keydown: (event) => {
                setModifier(event);
                return onKey(event);
            },
            keyup: (event) => {
                setModifier(event);
            },
            blur: () => {
                delete view.dom.dataset.lcMod;
            },
        }),
        Ev.updateListener.of((update) => {
            if (disposed || update.view !== view) return;
            foreign.update(update);
            if (update.docChanged) {
                card.edited();
                for (const l of changeListeners) l();
                return;
            }
            if (update.geometryChanged) card.popover.reposition();
            if (update.transactions.some((tr) => tr.effects.some((e) => e.is(diagnosticsEffect)))) card.republished();
        }),
        themeFor(Ev),
        ...(foreignSpecs.length > 0 ? [absorbField, absorbThemeFor(Ev, foreignSpecs)] : []),
    ];
    const extension: Extension = compartment === undefined ? parts : compartment.of(parts);

    const adapter: EditorAdapter = {
        uri,
        languageId,
        getText: () => view.state.doc.toString(),
        onDidChange: (listener) => {
            changeListeners.push(listener);
        },
        renderDiagnostics: (diagnostics) => {
            if (!disposed) view.dispatch({ effects: diagnosticsEffect.of(diagnostics) });
        },
        renderHints: (hints) => {
            if (!disposed) view.dispatch({ effects: hintsEffect.of(hints) });
        },
        applyEdits: (edits: readonly TextEdit[]) => {
            // Not after the site swapped in another state (a file switch):
            // our field is gone with it, and the text is another file's.
            if (disposed || view.state.field(diagnosticField, false) === undefined) return false;
            // A dispatch applies even to a read-only editor (read-only only
            // stops typing): a view-only collaborator's copy would diverge.
            if (view.state.readOnly || !view.contentDOM.isContentEditable) return false;
            const { doc } = view.state;
            if (!editsHold(edits, doc.length, (from, to) => doc.sliceString(from, to))) return false;
            view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), userEvent: 'input.complete' });
            return true;
        },
        select: (from, to) => {
            if (disposed) return;
            const length = view.state.doc.length;
            const anchor = Math.max(0, Math.min(from, length));
            const head = Math.max(anchor, Math.min(to, length));
            view.dispatch({ selection: { anchor, head }, effects: Ev.scrollIntoView(anchor, { y: 'center' }) });
        },
        foreignFindings: () => (disposed ? [] : foreign.read(view)),
        onDidChangeForeign: (listener) => {
            foreign.onDidAnswer(listener);
        },
        setForeignHidden: (hidden) => {
            if (!disposed && foreignSpecs.length > 0 && view.state.field(absorbField, false) !== hidden) view.dispatch({ effects: absorbEffect.of(hidden) });
        },
        focusOffset: () => {
            if (disposed) return;
            // What is on screen, whichever scrolls: the editor's own
            // scroller (Overleaf) or the page around an editor of full height.
            const box = view.scrollDOM.getBoundingClientRect();
            const shownTop = Math.max(box.top, 0) - view.documentTop;
            const shownBottom = Math.min(box.bottom, window.innerHeight) - view.documentTop;
            const top = view.lineBlockAtHeight(Math.max(shownTop, 0)).from;
            const bottom = view.lineBlockAtHeight(Math.max(shownBottom, 0)).to;
            const cursor = view.state.selection.main.head;
            return cursor >= top && cursor <= bottom ? cursor : top;
        },
        ...cardMembers(card),
    };

    return {
        adapter,
        extension,
        isInstalled: () => view.state.field(diagnosticField, false) !== undefined,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            card.dispose();
            foreign.dispose();
            changeListeners.length = 0;
            delete view.dom.dataset.lcMod;
            // Only when our compartment is still in this state: after a
            // setState it is gone, and reconfiguring it would throw. Without
            // a Compartment, the fields stay installed but empty and inert.
            if (view.state.field(diagnosticField, false) === undefined) return;
            view.dispatch({
                effects: compartment === undefined ? [diagnosticsEffect.of([]), hintsEffect.of([]), absorbEffect.of(false)] : compartment.reconfigure([]),
            });
        },
    };
}


/**
 * One mark per hint position: on the character before it (`::after`), or on
 * the character after it when the hint starts a line (`::before`). A hint on
 * an empty line has no character to hang on and is not shown.
 */
export function hintMarks(doc: Text, hints: readonly RenderedHint[], Decoration: Cm6Kit['Decoration']): CmRange<CmDecoration>[] {
    const byPosition = new Map<number, RenderedHint[]>();
    for (const hint of hints) {
        if (!Number.isSafeInteger(hint.at) || hint.at < 0 || hint.at > doc.length) continue;
        // A position inside a surrogate pair is not a place in the text;
        // the hint goes after the whole character.
        const at = isLowSurrogate(doc.sliceString(hint.at, hint.at + 1)) && isHighSurrogate(doc.sliceString(hint.at - 1, hint.at)) ? hint.at + 1 : hint.at;
        byPosition.set(at, [...(byPosition.get(at) ?? []), hint]);
    }
    return [...byPosition].flatMap(([at, lcHints]) => {
        const line = doc.lineAt(at);
        // The gap before the ghost text is the style's, not the label's.
        const label = lcHints.map((hint) => hint.label.trim()).join(' ');
        if (at > line.from) {
            // Step back over a whole surrogate pair, never into its middle.
            const from = at - (isLowSurrogate(doc.sliceString(at - 1, at)) && at - 2 >= line.from ? 2 : 1);
            return [Decoration.mark({ class: 'lc-hint-after', attributes: { 'data-lc-hint': label }, lcHints }).range(from, at)];
        }
        if (at < line.to) {
            const to = at + (isHighSurrogate(doc.sliceString(at, at + 1)) && at + 2 <= line.to ? 2 : 1);
            return [Decoration.mark({ class: 'lc-hint-before', attributes: { 'data-lc-hint': label }, lcHints }).range(at, to)];
        }
        return [];
    });
}

const isHighSurrogate = (unit: string): boolean => unit.length === 1 && unit.charCodeAt(0) >= 0xD8_00 && unit.charCodeAt(0) <= 0xDB_FF;
const isLowSurrogate = (unit: string): boolean => unit.length === 1 && unit.charCodeAt(0) >= 0xDC_00 && unit.charCodeAt(0) <= 0xDF_FF;

/**
 * A field of decorations that follow every edit, and are replaced wholesale
 * whenever `effect` carries a new list: the shape of both our layers.
 */
function replacedDecorations<T>(
    kit: Cm6Kit,
    effect: StateEffectType<readonly T[]>,
    build: (doc: Text, values: readonly T[]) => CmRange<CmDecoration>[],
): StateField<DecorationSet> {
    return kit.StateField.define<DecorationSet>({
        create: () => kit.Decoration.none,
        update(set, tr) {
            let next = set.map(tr.changes);
            for (const e of tr.effects) {
                if (e.is(effect)) next = kit.Decoration.set(build(tr.state.doc, e.value), true);
            }
            return next;
        },
        provide: (field) => kit.EditorView.decorations.from(field),
    });
}
