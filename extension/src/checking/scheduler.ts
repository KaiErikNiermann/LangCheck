/**
 * Pacing the checks: how many run at once, and waiting for typing to stop.
 */

/**
 * A fixed number of check slots, handed to waiters in the order they asked.
 *
 * Each CheckProse holds the core's orchestrator for as long as its engines
 * take, seconds for LanguageTool, so an unbounded number in flight floods the
 * server without finishing any of them sooner.
 */
export class CheckSlots {
    private active = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly max: number) {}

    /** Resolves immediately if under the limit, otherwise once a slot frees up. */
    acquire(): Promise<void> {
        if (this.active < this.max) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    /** Release a slot and wake the next queued caller, if any. */
    release(): void {
        const next = this.queue.shift();
        if (next) {
            next(); // slot stays occupied — transferred to the next waiter
        } else {
            this.active--;
        }
    }
}

/** One pending timer per key, replaced whenever the key is scheduled again. */
export class Debouncer {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    schedule(key: string, delayMs: number, run: () => void): void {
        const existing = this.timers.get(key);
        if (existing) clearTimeout(existing);
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            run();
        }, delayMs));
    }

    cancel(key: string): void {
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(key);
        }
    }

    cancelAll(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
