// When the card opens, what it shows, and when it closes, for any editor.
// An adapter reports pointer positions, keys, edits and republished
// findings; the controller decides. The rules:
//
// - The pointer must rest HOVER_DELAY_MS on a finding (or, with hover
//   providers, a word) before anything is fetched.
// - A fetch that comes back for a target the pointer has since left is
//   dropped (`generation`), so a slow core never opens a stale card.
// - Any edit closes the card: what it offers (a fix's range, the word it
//   quotes) was for text that no longer exists.
// - A recheck that drops or reshapes the finding closes the card; one that
//   keeps it refreshes the card, so actions withheld while the check was
//   stale appear.
import type { Popover, PopoverContent } from './popover';
import type { ActionSource, EditorAdapter, HoverSource, RenderedDiagnostic } from './types';

/** Pointer must rest this long before we ask for actions (VS Code uses 300ms). */
export const HOVER_DELAY_MS = 300;

export interface Span {
    readonly from: number;
    readonly to: number;
}

export type Finding = RenderedDiagnostic & Span;

interface Target extends Span {
    readonly kind: 'diagnostic' | 'word';
}

/** What the controller needs from the editor it serves. */
export interface CardHost {
    /** The finding covering `pos`, at its current position. */
    findingAt(pos: number): Finding | undefined;
    /** The word around `pos`, for hover providers. */
    wordAt(pos: number): Span | undefined;
    readonly popover: Popover;
}

const NO_ACTIONS: ActionSource = () => Promise.resolve([]);

/** The EditorAdapter members every adapter hands to its card unchanged. */
export function cardMembers(card: CardController): Pick<EditorAdapter, 'setActionSource' | 'setHoverSource' | 'notify'> {
    return {
        setActionSource: (source) => {
            card.setActionSource(source);
        },
        setHoverSource: (source) => {
            card.setHoverSource(source);
        },
        notify: (message) => {
            card.popover.toast(message);
        },
    };
}

export class CardController {
    private actionSource: ActionSource = NO_ACTIONS;
    private hoverSource: HoverSource | undefined;
    private target: Target | undefined;
    private generation = 0;
    private hoverTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(private readonly host: CardHost) {
        host.popover.onLeave(() => {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = setTimeout(() => {
                this.close();
            }, HOVER_DELAY_MS);
        });
    }

    setActionSource(source: ActionSource): void {
        this.actionSource = source;
    }

    setHoverSource(source: HoverSource): void {
        this.hoverSource = source;
    }

    get popover(): Popover {
        return this.host.popover;
    }

    /** The pointer is over document offset `pos` (undefined: over no text). */
    pointerAt(pos: number | undefined): void {
        if (this.disposed) return;
        const target = pos === undefined ? undefined : this.targetAt(pos);
        if (target !== undefined && this.target !== undefined && target.from === this.target.from && target.to === this.target.to) {
            clearTimeout(this.hoverTimer);
            return;
        }
        clearTimeout(this.hoverTimer);
        this.hoverTimer = setTimeout(() => {
            if (target === undefined || pos === undefined) this.close();
            else void this.open(target, pos, false);
        }, HOVER_DELAY_MS);
    }

    /** The pointer is over the card itself: keep it. */
    pointerOnCard(): void {
        clearTimeout(this.hoverTimer);
    }

    /** Ctrl+. at the cursor. Returns whether a card opened (so the key is consumed). */
    openAtCursor(pos: number): boolean {
        // The cursor sits after the last letter when a word was just typed.
        const finding = this.host.findingAt(pos) ?? this.host.findingAt(pos - 1);
        if (finding === undefined) return false;
        void this.open({ from: finding.from, to: finding.to, kind: 'diagnostic' }, finding.from, true);
        return true;
    }

    /** Escape in the text. Returns whether it closed a card. */
    escape(): boolean {
        if (!this.host.popover.visible) return false;
        this.close();
        return true;
    }

    edited(): void {
        this.close();
    }

    republished(): void {
        const target = this.target;
        if (target?.kind !== 'diagnostic') return;
        const still = this.host.findingAt(target.from);
        if (still === undefined || still.from !== target.from || still.to !== target.to) this.close();
        else if (this.host.popover.visible) void this.open(target, target.from, false);
    }

    close(): void {
        clearTimeout(this.hoverTimer);
        this.generation++;
        this.target = undefined;
        this.host.popover.hide();
    }

    dispose(): void {
        this.close();
        this.disposed = true;
        this.host.popover.destroy();
    }

    /** A finding if there is one, else the word (only when hover providers exist). */
    private targetAt(pos: number): Target | undefined {
        const finding = this.host.findingAt(pos);
        if (finding !== undefined) return { from: finding.from, to: finding.to, kind: 'diagnostic' };
        if (this.hoverSource === undefined) return undefined;
        const word = this.host.wordAt(pos);
        return word === undefined ? undefined : { ...word, kind: 'word' };
    }

    private async open(target: Target, pos: number, focus: boolean): Promise<void> {
        const mine = ++this.generation;
        this.target = target;
        const finding = target.kind === 'diagnostic' ? this.host.findingAt(target.from) : undefined;
        const report = (error: unknown): never[] => {
            console.error('[language-check]', error);
            this.host.popover.toast(`LangCheck: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        };
        const [actions, hover] = await Promise.all([
            finding === undefined ? [] : this.actionSource(target.from, target.to).catch(report),
            this.hoverSource === undefined ? [] : this.hoverSource(pos).catch(report),
        ]);
        if (mine !== this.generation || this.disposed) return;
        const content: PopoverContent = {
            message: finding?.message,
            paragraphs: hover,
            actions: actions.map((a) => ({
                title: a.title,
                run: () => {
                    this.close();
                    a.run().catch(report);
                },
            })),
        };
        if (content.message === undefined && content.paragraphs.length === 0) {
            this.close();
            return;
        }
        this.host.popover.show(target.from, content, {
            focus,
            onDismiss: () => {
                this.close();
            },
        });
    }
}
