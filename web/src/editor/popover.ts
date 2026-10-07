// Our own hover card. CM6's `hoverTooltip` is a plain function, not a class
// we can recover from a host page's running editor (see cm6kit.ts), so on
// Overleaf there is no way to use it. This is a positioned element inside
// `view.scrollDOM` (which CM6 makes `position: relative`), so it scrolls with
// the text, picks up the editor's base theme, and is removed with the editor.
import type { EditorView } from '@codemirror/view';

export interface PopoverAction {
    readonly title: string;
    run(): void;
}

export interface PopoverContent {
    readonly message: string | undefined;
    readonly paragraphs: readonly string[];
    readonly actions: readonly PopoverAction[];
}

export interface ShowOptions {
    /** Move keyboard focus to the first action (keyboard-invoked popovers). */
    readonly focus: boolean;
    /** Escape, or the anchor scrolled out of the rendered viewport: the owner closes. */
    readonly onDismiss: () => void;
}

interface Placement {
    readonly top: number;
    readonly left: number;
}

/** How long a toast stays up. */
const TOAST_MS = 4000;

export class Popover {
    private readonly dom: HTMLDivElement;
    private leaveListener: (() => void) | undefined;
    private toastTimer: ReturnType<typeof setTimeout> | undefined;
    private toastDom: HTMLDivElement | undefined;
    private anchor: { readonly at: number; readonly onDismiss: () => void } | undefined;

    constructor(private readonly view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'lc-popover';
        this.dom.setAttribute('role', 'dialog');
        this.dom.hidden = true;
        this.dom.addEventListener('mouseleave', () => this.leaveListener?.());
        // Keep CM from treating clicks in the card as editor clicks (which
        // would move the cursor and, on Overleaf, steal focus mid-action).
        this.dom.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        // One listener for the card's whole life, reading the current anchor:
        // installed per show(), they piled up with every hover and recheck.
        this.dom.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || this.anchor === undefined) return;
            e.preventDefault();
            this.anchor.onDismiss();
            this.view.focus();
        });
    }

    get visible(): boolean {
        return !this.dom.hidden && this.dom.isConnected;
    }

    contains(node: EventTarget | null): boolean {
        return node instanceof Node && this.dom.contains(node);
    }

    onLeave(listener: () => void): void {
        this.leaveListener = listener;
    }

    /** Where the card goes for an anchor at `at`, or null when `at` is not rendered. */
    private measure(at: number): Placement | null {
        const coords = this.view.coordsAtPos(at);
        if (coords === null) return null;
        const scroller = this.view.scrollDOM;
        const box = scroller.getBoundingClientRect();
        return { top: coords.bottom - box.top + scroller.scrollTop + 2, left: coords.left - box.left + scroller.scrollLeft };
    }

    private apply(placement: Placement): void {
        this.dom.style.top = `${placement.top}px`;
        this.dom.style.left = `${placement.left}px`;
    }

    show(at: number, content: PopoverContent, options: ShowOptions): void {
        const placement = this.measure(at);
        if (placement === null) {
            // Scrolled out of the rendered viewport between hover and fetch.
            options.onDismiss();
            return;
        }
        this.anchor = { at, onDismiss: options.onDismiss };
        const children: HTMLElement[] = [];
        for (const text of [content.message, ...content.paragraphs]) {
            if (text === undefined) continue;
            const p = document.createElement('p');
            p.textContent = text;
            children.push(p);
        }
        for (const action of content.actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'lc-action';
            button.textContent = action.title;
            button.addEventListener('click', () => { action.run(); });
            children.push(button);
        }
        this.dom.replaceChildren(...children);

        if (this.dom.parentNode !== this.view.scrollDOM) this.view.scrollDOM.append(this.dom);
        this.apply(placement);
        this.dom.hidden = false;
        if (options.focus) this.dom.querySelector('button')?.focus();
    }

    /**
     * Re-places the card after the editor's layout changed under it (a host
     * reconfigure, a font change, Overleaf's Visual/Code switch). Goes through
     * requestMeasure so layout is read in CM's measure phase, never mid-update.
     */
    reposition(): void {
        if (this.anchor === undefined || !this.visible) return;
        const { at, onDismiss } = this.anchor;
        this.view.requestMeasure({
            key: this,
            read: () => (at <= this.view.state.doc.length ? this.measure(at) : null),
            write: (placement) => {
                if (this.anchor?.at !== at) return;
                if (placement === null) onDismiss();
                else this.apply(placement);
            },
        });
    }

    hide(): void {
        this.anchor = undefined;
        this.dom.hidden = true;
        this.dom.replaceChildren();
    }

    toast(message: string): void {
        clearTimeout(this.toastTimer);
        this.toastDom?.remove();
        const toast = document.createElement('div');
        toast.className = 'lc-toast';
        toast.setAttribute('role', 'status');
        toast.textContent = message;
        this.view.dom.append(toast);
        this.toastDom = toast;
        this.toastTimer = setTimeout(() => { toast.remove(); }, TOAST_MS);
    }

    destroy(): void {
        clearTimeout(this.toastTimer);
        this.toastDom?.remove();
        this.dom.remove();
    }
}
