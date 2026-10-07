// Our own hover card. CM6's `hoverTooltip` is a plain function no host page
// exposes (see cm6kit.ts), and a DOM editor like Notion has nothing of the
// kind, so the card is an element we position ourselves. Where it lives and
// how an offset in the document maps to the screen is the editor's business,
// behind PopoverSurface; everything else about the card is shared.

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
    /** Escape, or the anchor left the rendered text: the owner closes. */
    readonly onDismiss: () => void;
}

export interface Placement {
    readonly top: number;
    readonly left: number;
}

/** What an editor provides for the card to live in. */
export interface PopoverSurface {
    /** The positioned element the card is appended to; placements are relative to it. */
    readonly mount: HTMLElement;
    /** Where toasts go (positioned, so they sit in its corner). */
    readonly toastMount: HTMLElement;
    /** Where the card goes for an anchor at document offset `at`, or null when `at` is not on screen. */
    place(at: number): Placement | null;
    /** Runs `read` then `write` in the editor's layout cycle (CM: requestMeasure). */
    measure<T>(read: () => T, write: (value: T) => void): void;
    /** Gives the keyboard back to the text after Escape. */
    focusEditor(): void;
}

/** How long a toast stays up. */
const TOAST_MS = 4000;

export class Popover {
    private readonly dom: HTMLDivElement;
    private leaveListener: (() => void) | undefined;
    private toastTimer: ReturnType<typeof setTimeout> | undefined;
    private toastDom: HTMLDivElement | undefined;
    private anchor: { readonly at: number; readonly onDismiss: () => void } | undefined;

    constructor(private readonly surface: PopoverSurface) {
        this.dom = document.createElement('div');
        this.dom.className = 'lc-popover';
        this.dom.setAttribute('role', 'dialog');
        this.dom.hidden = true;
        this.dom.addEventListener('mouseleave', () => this.leaveListener?.());
        // Keep the editor from treating clicks in the card as editor clicks
        // (which would move the cursor and steal focus mid-action).
        this.dom.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        // One listener for the card's whole life, reading the current anchor:
        // installed per show(), they piled up with every hover and recheck.
        this.dom.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || this.anchor === undefined) return;
            e.preventDefault();
            this.anchor.onDismiss();
            this.surface.focusEditor();
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

    private apply(placement: Placement): void {
        this.dom.style.top = `${String(placement.top)}px`;
        this.dom.style.left = `${String(placement.left)}px`;
    }

    show(at: number, content: PopoverContent, options: ShowOptions): void {
        const placement = this.surface.place(at);
        if (placement === null) {
            // Scrolled out of the rendered text between hover and fetch.
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
            button.addEventListener('click', () => {
                action.run();
            });
            children.push(button);
        }
        this.dom.replaceChildren(...children);
        if (this.dom.parentNode !== this.surface.mount) this.surface.mount.append(this.dom);
        this.apply(placement);
        this.dom.hidden = false;
        if (options.focus) this.dom.querySelector('button')?.focus();
    }

    /**
     * Re-places the card after the layout changed under it (a host
     * reconfigure, a font change, Overleaf's Visual/Code switch), in the
     * editor's measure cycle so layout is never read mid-update.
     */
    reposition(): void {
        if (this.anchor === undefined || !this.visible) return;
        const { at, onDismiss } = this.anchor;
        this.surface.measure(
            () => this.surface.place(at),
            (placement) => {
                if (this.anchor?.at !== at) return;
                if (placement === null) onDismiss();
                else this.apply(placement);
            },
        );
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
        this.surface.toastMount.append(toast);
        this.toastDom = toast;
        this.toastTimer = setTimeout(() => {
            toast.remove();
        }, TOAST_MS);
    }

    destroy(): void {
        clearTimeout(this.toastTimer);
        this.toastDom?.remove();
        this.dom.remove();
    }
}
