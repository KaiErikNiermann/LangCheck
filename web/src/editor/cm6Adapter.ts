// CodeMirror 6 adapter: the editor Overleaf runs. Diagnostics become mark
// decorations in a StateField of our own (a sibling of any lint field the host
// page has), mapped through edits so they stay put until the next check lands.
// Hovering a mark, or Ctrl+. on it, opens our popover with its code actions.
//
// Everything CodeMirror is reached through `kit`, never imported, so the same
// code runs against our own modules or a host page's (see cm6kit.ts).
import type { Extension, Range as CmRange, StateEffectType, StateField, Text } from '@codemirror/state';
import type { Decoration as CmDecoration, DecorationSet, EditorView } from '@codemirror/view';
import type { Cm6Kit } from './cm6kit';
import { Popover, type PopoverContent } from './popover';
import type { ActionSource, EditorAdapter, HoverSource, RenderedDiagnostic, RenderedHint, TextEdit } from './types';

const SEVERITY_CLASS = ['lc-error', 'lc-warning', 'lc-info', 'lc-hint'] as const;

const NO_ACTIONS: ActionSource = () => Promise.resolve([]);

/** Pointer must rest this long before we ask for actions (VS Code uses 300ms). */
const HOVER_DELAY_MS = 300;

interface Span {
    readonly from: number;
    readonly to: number;
    readonly kind: 'diagnostic' | 'word';
}

export interface Cm6Adapter {
    readonly adapter: EditorAdapter;
    readonly extension: Extension;
    /** Whether the view's current state still carries our extension (a setState or reconfigure can drop it). */
    isInstalled(): boolean;
    /** Removes the extension from the view, closes the popover, and stops change notifications. */
    dispose(): void;
}

export function createCm6Adapter(view: EditorView, kit: Cm6Kit, uri: string, languageId: string): Cm6Adapter {
    const { Compartment, Decoration, EditorView: Ev, StateEffect } = kit;
    const compartment = Compartment === undefined ? undefined : new Compartment();
    const diagnosticsEffect = StateEffect.define<readonly RenderedDiagnostic[]>();
    const hintsEffect = StateEffect.define<readonly RenderedHint[]>();

    // The marks are the only copy of where findings are: CM6 maps them
    // through every edit, and lookups read them back (diagnosticAt), so a
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
    let actionSource: ActionSource = NO_ACTIONS;
    let hoverSource: HoverSource | undefined;
    let disposed = false;

    const popover = new Popover(view);
    /** The span the popover is for, or is being fetched for. */
    let target: Span | undefined;
    /** Bumped on every new target, so a late fetch for an old one is dropped. */
    let generation = 0;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;

    /** The finding under `pos`, at its current (mapped) position. */
    const diagnosticAt = (pos: number): (RenderedDiagnostic & { readonly from: number; readonly to: number }) | undefined => {
        let hit: (RenderedDiagnostic & { from: number; to: number }) | undefined;
        view.state.field(diagnosticField, false)?.between(pos, pos + 1, (from, to, deco) => {
            const diagnostic = (deco.spec as { lcDiagnostic?: RenderedDiagnostic }).lcDiagnostic;
            if (diagnostic === undefined || pos < from || pos >= to) return;
            hit = { ...diagnostic, from, to };
            return false;
        });
        return hit;
    };

    const close = (): void => {
        clearTimeout(hoverTimer);
        generation++;
        target = undefined;
        popover.hide();
    };

    const open = async (span: Span, pos: number, focus: boolean): Promise<void> => {
        const mine = ++generation;
        target = span;
        const diagnostic = span.kind === 'diagnostic' ? diagnosticAt(span.from) : undefined;
        const [actions, hover] = await Promise.all([
            diagnostic === undefined ? [] : actionSource(span.from, span.to).catch(reportError),
            hoverSource === undefined ? [] : hoverSource(pos).catch(reportError),
        ]);
        if (mine !== generation || disposed) return;
        const content: PopoverContent = {
            message: diagnostic?.message,
            paragraphs: hover,
            actions: actions.map((a) => ({
                title: a.title,
                run: () => {
                    close();
                    a.run().catch(reportError);
                },
            })),
        };
        if (content.message === undefined && content.paragraphs.length === 0) {
            close();
            return;
        }
        popover.show(span.from, content, { focus, onDismiss: close });
    };

    const reportError = (error: unknown): never[] => {
        console.error('[lc-cm6]', error);
        adapter.notify(`LangCheck: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    };

    /** The span under the pointer: a diagnostic if there is one, else the word (for hover providers). */
    const spanAt = (pos: number): Span | undefined => {
        const diagnostic = diagnosticAt(pos);
        if (diagnostic !== undefined) return { from: diagnostic.from, to: diagnostic.to, kind: 'diagnostic' };
        if (hoverSource === undefined) return undefined;
        const word = view.state.wordAt(pos);
        return word === null ? undefined : { from: word.from, to: word.to, kind: 'word' };
    };

    const onPointer = (event: MouseEvent): void => {
        if (disposed) return;
        if (popover.contains(event.target)) {
            clearTimeout(hoverTimer);
            return;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const span = pos === null ? undefined : spanAt(pos);
        if (span !== undefined && target !== undefined && span.from === target.from && span.to === target.to) {
            clearTimeout(hoverTimer);
            return;
        }
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            if (span === undefined || pos === null) close();
            else void open(span, pos, false);
        }, HOVER_DELAY_MS);
    };

    const onKey = (event: KeyboardEvent): boolean => {
        if (event.key === 'Escape' && popover.visible) {
            close();
            return true;
        }
        if (event.key !== '.' || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.state.selection.main.head;
        // The cursor sits after the last letter when a word was just typed.
        const diagnostic = diagnosticAt(pos) ?? diagnosticAt(pos - 1);
        if (diagnostic === undefined) return false;
        void open({ from: diagnostic.from, to: diagnostic.to, kind: 'diagnostic' }, diagnostic.from, true);
        return true;
    };

    const parts: Extension = [
        diagnosticField,
        hintField,
        Ev.domEventHandlers({
            mousemove: (event) => { onPointer(event); },
            mouseleave: (event) => {
                if (!popover.contains(event.relatedTarget)) onPointer(event);
            },
            keydown: (event) => onKey(event),
        }),
        Ev.updateListener.of((update) => {
            if (disposed || update.view !== view) return;
            if (update.docChanged) {
                // Any edit invalidates what the popover offers (a fix's range,
                // the word it quotes), so it never outlives the text it was for.
                close();
                for (const l of changeListeners) l();
                return;
            }
            if (update.geometryChanged) popover.reposition();
            // A recheck that drops or reshapes the finding under the popover
            // (add-to-dictionary, say) closes it rather than leaving it stale.
            if (target?.kind !== 'diagnostic') return;
            const still = diagnosticAt(target.from);
            if (still === undefined || still.from !== target.from || still.to !== target.to) close();
        }),
        Ev.baseTheme(THEME),
    ];
    const extension: Extension = compartment === undefined ? parts : compartment.of(parts);
    popover.onLeave(() => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(close, HOVER_DELAY_MS);
    });

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
            if (disposed) return;
            const length = view.state.doc.length;
            if (edits.some((e) => e.from < 0 || e.to < e.from || e.to > length)) {
                throw new RangeError(`edit outside the document (length ${length})`);
            }
            view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), userEvent: 'input.complete' });
        },
        setActionSource: (source) => {
            actionSource = source;
        },
        setHoverSource: (source) => {
            hoverSource = source;
        },
        notify: (message) => { popover.toast(message); },
    };

    return {
        adapter,
        extension,
        isInstalled: () => view.state.field(diagnosticField, false) !== undefined,
        dispose: () => {
            if (disposed) return;
            close();
            disposed = true;
            changeListeners.length = 0;
            popover.destroy();
            // Only when our compartment is still in this state: after a
            // setState it is gone, and reconfiguring it would throw. Without
            // a Compartment, the fields stay installed but empty and inert.
            if (view.state.field(diagnosticField, false) === undefined) return;
            view.dispatch({
                effects: compartment === undefined ? [diagnosticsEffect.of([]), hintsEffect.of([])] : compartment.reconfigure([]),
            });
        },
    };
}

const THEME = {
    '.lc-diag': { textDecoration: 'underline wavy', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
    '.lc-error': { textDecorationColor: '#d33' },
    '.lc-warning': { textDecorationColor: '#d80' },
    '.lc-info, .lc-hint': { textDecorationColor: 'steelblue' },
    // inline-block, so the finding's wavy underline does not run under it.
    '.lc-hint-after::after, .lc-hint-before::before': {
        content: 'attr(data-lc-hint)',
        display: 'inline-block',
        opacity: '0.6',
        fontStyle: 'italic',
        paddingInline: '0.3em',
        pointerEvents: 'none',
        userSelect: 'none',
    },
    '.lc-popover': {
        position: 'absolute',
        zIndex: '200',
        maxWidth: '28em',
        padding: '6px 8px',
        border: '1px solid #8886',
        borderRadius: '4px',
        background: '#fff',
        color: '#222',
        boxShadow: '0 2px 8px #0003',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        whiteSpace: 'normal',
    },
    '&dark .lc-popover': { background: '#252526', color: '#ddd' },
    '.lc-popover p': { margin: '0 0 4px' },
    '.lc-action': { display: 'block', margin: '2px 0', font: 'inherit', cursor: 'pointer' },
    '.lc-toast': {
        position: 'absolute',
        insetBlockEnd: '8px',
        insetInlineEnd: '8px',
        zIndex: '200',
        padding: '4px 8px',
        borderRadius: '4px',
        background: '#333',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
    },
} as const;

/**
 * One mark per hint position: on the character before it (`::after`), or on
 * the character after it when the hint starts a line (`::before`). A hint on
 * an empty line has no character to hang on and is not shown.
 */
export function hintMarks(doc: Text, hints: readonly RenderedHint[], Decoration: Cm6Kit['Decoration']): CmRange<CmDecoration>[] {
    const byPosition = new Map<number, string[]>();
    for (const hint of hints) {
        if (!Number.isSafeInteger(hint.at) || hint.at < 0 || hint.at > doc.length) continue;
        // A position inside a surrogate pair is not a place in the text;
        // the hint goes after the whole character.
        const at = isLowSurrogate(doc.sliceString(hint.at, hint.at + 1)) && isHighSurrogate(doc.sliceString(hint.at - 1, hint.at)) ? hint.at + 1 : hint.at;
        byPosition.set(at, [...(byPosition.get(at) ?? []), hint.label]);
    }
    return [...byPosition].flatMap(([at, labels]) => {
        const line = doc.lineAt(at);
        const label = labels.join(' ');
        if (at > line.from) {
            // Step back over a whole surrogate pair, never into its middle.
            const from = at - (isLowSurrogate(doc.sliceString(at - 1, at)) && at - 2 >= line.from ? 2 : 1);
            return [Decoration.mark({ class: 'lc-hint-after', attributes: { 'data-lc-hint': label } }).range(from, at)];
        }
        if (at < line.to) {
            const to = at + (isHighSurrogate(doc.sliceString(at, at + 1)) && at + 2 <= line.to ? 2 : 1);
            return [Decoration.mark({ class: 'lc-hint-before', attributes: { 'data-lc-hint': label } }).range(at, to)];
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
