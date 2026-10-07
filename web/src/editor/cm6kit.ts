// The CodeMirror classes the adapter is allowed to touch. On a page we build
// (tests), they come from our own `@codemirror/*` imports. On a page we join
// (Overleaf, Typst), they must be the page's own instances: CM6 checks
// identity (`effect.is(type)`, `state.field(field)`, facet ids), so a second
// bundled copy cannot talk to the page's editor at all. Only type imports
// appear here, so nothing from `@codemirror/*` is bundled by this file.
//
// Discovery prefers public API and falls back to internals only where CM6
// offers no public path (StateField, Compartment). Every candidate is checked
// by shape before use, and a miss is reported by name, so a CodeMirror
// upgrade on a site degrades to "not attached: StateField not found" rather
// than to misbehaviour. test/e2e runs discovery against CodeMirror on both
// sides of the 6.39 tile rewrite.
import type { Compartment, StateEffect, StateField } from '@codemirror/state';
import type { Decoration, EditorView } from '@codemirror/view';

export interface Cm6Kit {
    readonly EditorView: typeof EditorView;
    readonly StateEffect: typeof StateEffect;
    readonly StateField: typeof StateField;
    readonly Decoration: typeof Decoration;
    /** Lets detach remove our extension cleanly; without it, detach leaves it installed but inert. */
    readonly Compartment: typeof Compartment | undefined;
}

export type KitDiscovery =
    | { readonly ok: true; readonly kit: Cm6Kit }
    | { readonly ok: false; readonly missing: readonly string[] };

/** Bounds the walk over the page's extension tree; Overleaf's has ~600 nodes. */
const MAX_EXTENSION_NODES = 50_000;

type Bag = Record<PropertyKey, unknown>;

const isObject = (v: unknown): v is Bag => typeof v === 'object' && v !== null;
const isFunction = (v: unknown): v is (...args: never[]) => unknown => typeof v === 'function';
const statics = (ctor: unknown): Bag => (isFunction(ctor) ? (ctor as unknown as Bag) : {});
const hasStatics = (ctor: unknown, ...names: readonly string[]): boolean =>
    isFunction(ctor) && names.every((n) => isFunction(statics(ctor)[n]));
const protoHas = (ctor: unknown, ...names: readonly string[]): boolean =>
    isFunction(ctor) && names.every((n) => isFunction((ctor.prototype as Bag | undefined)?.[n]));

/**
 * The topmost constructor in `value`'s prototype chain that has every one of
 * `names` as a static. Subclasses inherit statics (`MarkDecoration.mark`
 * exists), so the first match would be the wrong class.
 */
function baseClassWith(value: unknown, ...names: readonly string[]): unknown {
    let found: unknown;
    for (let proto: unknown = isObject(value) ? Object.getPrototypeOf(value) : undefined; isObject(proto); proto = Object.getPrototypeOf(proto)) {
        if (hasStatics(proto.constructor, ...names)) found = proto.constructor;
    }
    return found;
}

/** `StateEffect` through public API: `EditorView.scrollIntoView` returns one. */
function stateEffectFrom(view: EditorView): unknown {
    const Ev = view.constructor as typeof EditorView;
    try {
        const ctor = (Ev.scrollIntoView(0) as unknown as Bag).constructor;
        return hasStatics(ctor, 'define') && isObject(statics(ctor).appendConfig) ? ctor : undefined;
    } catch {
        return undefined;
    }
}

/** Internal: the state's compartments map is keyed by Compartment instances. */
function compartmentFrom(view: EditorView): unknown {
    const compartments = (view.state as unknown as { config?: { compartments?: unknown } }).config?.compartments;
    if (!(compartments instanceof Map)) return undefined;
    for (const key of compartments.keys()) {
        const ctor = isObject(key) ? key.constructor : undefined;
        if (protoHas(ctor, 'of', 'reconfigure', 'get')) return ctor;
    }
    return undefined;
}

/** Internal: StateField instances sit in the flattened extension tree as objects with createF/updateF. */
function stateFieldFrom(view: EditorView): unknown {
    const base = (view.state as unknown as { config?: { base?: unknown } }).config?.base;
    const stack: unknown[] = [base];
    const seen = new Set<unknown>();
    while (stack.length > 0 && seen.size < MAX_EXTENSION_NODES) {
        const node = stack.pop();
        if (!isObject(node) || seen.has(node)) continue;
        seen.add(node);
        if (Array.isArray(node)) {
            stack.push(...(node as unknown[]));
            continue;
        }
        if ('createF' in node && 'updateF' in node && hasStatics(node.constructor, 'define')) return node.constructor;
        if ('inner' in node) stack.push(node.inner);
        if ('extension' in node) stack.push(node.extension);
    }
    return undefined;
}

/** Public objects: any decoration the page renders leads to the Decoration base class. */
function decorationFrom(view: EditorView): unknown {
    const Ev = view.constructor as typeof EditorView;
    const plugins = (view as unknown as { plugins?: readonly { value?: { decorations?: unknown } }[] }).plugins ?? [];
    const sources: unknown[] = [...view.state.facet(Ev.decorations), ...plugins.map((p) => p.value?.decorations)];
    for (const source of sources) {
        const set = isFunction(source) ? (source as (v: EditorView) => unknown)(view) : source;
        if (!isObject(set) || !isFunction(set.iter)) continue;
        const iterator = (set.iter as () => { value: unknown; next(): void })();
        for (let i = 0; i < 1000 && iterator.value !== null && iterator.value !== undefined; i++) {
            const found = baseClassWith(iterator.value, 'mark', 'set', 'widget', 'replace', 'line');
            if (found !== undefined && isObject(statics(found).none)) return found;
            iterator.next();
        }
    }
    return undefined;
}

/**
 * Finds the classes by shape in the running editor. Names are useless here:
 * the page's bundle is minified, so `StateEffect` may be called `wt`.
 */
export function discoverCm6Kit(view: EditorView): KitDiscovery {
    const Ev = view.constructor as typeof EditorView;
    const editorView = hasStatics(Ev, 'domEventHandlers', 'baseTheme', 'scrollIntoView') && isObject(statics(Ev).updateListener) && isObject(statics(Ev).decorations);
    const stateEffect = stateEffectFrom(view);
    const stateField = stateFieldFrom(view);
    const decoration = decorationFrom(view);
    const compartment = compartmentFrom(view);
    const missing = [
        ...(editorView ? [] : ['EditorView']),
        ...(stateEffect === undefined ? ['StateEffect'] : []),
        ...(stateField === undefined ? ['StateField'] : []),
        ...(decoration === undefined ? ['Decoration'] : []),
    ];
    if (missing.length > 0) return { ok: false, missing };
    return {
        ok: true,
        kit: {
            EditorView: Ev,
            StateEffect: stateEffect as typeof StateEffect,
            StateField: stateField as typeof StateField,
            Decoration: decoration as typeof Decoration,
            Compartment: compartment as typeof Compartment | undefined,
        },
    };
}

/**
 * The view behind a `.cm-content` element, without the EditorView class
 * (`EditorView.findFromDOM` would need it, and finding it is the point).
 * CodeMirror moved the link in 6.39.0: before, the element carries
 * `cmView.view`; from the tile rewrite on, `cmTile.root.view`. Overleaf and
 * Typst ran the former on 2026-10-07.
 */
export function viewFromContentDom(content: Element | null): EditorView | undefined {
    // tsc needs this (Element has no cmView); typescript-eslint's program disagrees.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const node = content as (Element & { cmView?: { view?: unknown }; cmTile?: { root?: { view?: unknown } } }) | null;
    const view = node?.cmView?.view ?? node?.cmTile?.root?.view;
    return isView(view) ? view : undefined;
}

export function isView(value: unknown): value is EditorView {
    return isObject(value) && isObject(value.state) && isFunction(value.dispatch) && isObject(value.scrollDOM) && isObject(value.contentDOM);
}
