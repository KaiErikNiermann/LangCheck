// Keeps the core's copy of the site's own dictionary (Typst's personal
// dictionary, Overleaf's learned words) the same as the site's: read once
// the client is up, read again whenever the site says it may have changed,
// sent only when it did. The core coerces, keeps and applies it
// (rust-core/src/site_dictionary.rs); after a change the open documents are
// checked again, so a word just taught to the site stops being marked.
import type { SiteDictionarySource } from '../sites/site';

/** The fewest milliseconds between two reads: the site's signals come in bursts. */
export const MIN_READ_INTERVAL_MS = 2000;

export interface SiteDictionarySync {
    /**
     * Reads the site's dictionary again soon: after this page wrote to it.
     * Sent even when it reads as the core last had it: the core took the
     * word before the site did, so a write that failed leaves the list the
     * same here and the word applied there, until this sends it.
     */
    refresh(): void;
    dispose(): void;
}

export interface SiteDictionaryDeps {
    /** Sends the words to the core; true once it took them. */
    send(source: string, words: readonly string[]): Promise<boolean>;
    /** The core has a new list: findings may have changed. */
    changed(): void;
    warn(message: string, error: unknown): void;
}

export function syncSiteDictionary(dictionary: SiteDictionarySource, deps: SiteDictionaryDeps): SiteDictionarySync {
    /** What the core holds, as sent; a read that matches it sends nothing. */
    let sent: string | undefined;
    let running = false;
    let again = false;
    let disposed = false;
    let lastRead = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async (): Promise<void> => {
        if (running) {
            again = true;
            return;
        }
        running = true;
        try {
            const words = await dictionary.read();
            const key = words === undefined ? undefined : JSON.stringify(words);
            if (!disposed && words !== undefined && key !== sent && (await deps.send(dictionary.source, words))) {
                sent = key;
                deps.changed();
            }
        } catch (error) {
            deps.warn(`could not read the ${dictionary.source} dictionary`, error);
        } finally {
            running = false;
            lastRead = Date.now();
            if (again) {
                again = false;
                schedule();
            }
        }
    };

    function schedule(): void {
        if (disposed || timer !== undefined) return;
        timer = setTimeout(
            () => {
                timer = undefined;
                void read();
            },
            Math.max(0, lastRead + MIN_READ_INTERVAL_MS - Date.now()),
        );
    }

    const stopWatching = dictionary.watch(schedule);
    void read();
    return {
        refresh: () => {
            sent = undefined;
            schedule();
        },
        dispose() {
            disposed = true;
            clearTimeout(timer);
            stopWatching();
        },
    };
}
