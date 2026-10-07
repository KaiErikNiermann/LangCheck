// How many tabs a page may make the extension open. The page world is
// untrusted (the site's scripts, and other extensions' scripts in it, share
// it), so every tab the extension opens for a page -- panels, the config
// page -- comes out of one budget per source tab: MAX_OPENS a minute. It
// belongs to the tab, not its content script, so a reload does not refill
// it, and it goes when the tab closes.

export const MAX_OPENS = 10;
export const OPEN_WINDOW_MS = 60_000;

export class OpenBudget {
    /** When each source tab last opened tabs, oldest first (at most MAX_OPENS each). */
    private readonly opens = new Map<number, number[]>();

    constructor(private readonly now: () => number = () => performance.now()) {}

    /** Whether `source` may open a tab now, counting the open if so. */
    take(source: number): boolean {
        const now = this.now();
        const recent = (this.opens.get(source) ?? []).filter((at) => now - at < OPEN_WINDOW_MS);
        if (recent.length >= MAX_OPENS) return false;
        recent.push(now);
        this.opens.set(source, recent);
        return true;
    }

    /** The tab closed. */
    forget(source: number): void {
        this.opens.delete(source);
    }
}
