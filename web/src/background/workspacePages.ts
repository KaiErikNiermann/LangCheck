// Each workspace's open pages (their content scripts' ports), so the
// background can tell them their config changed. A port's workspace is
// known only once the browser has said which URL its tab is on; the port
// can go before that, and must then never be counted.

export class WorkspacePages<P> {
    private readonly byWorkspace = new Map<string, Set<P>>();

    /**
     * `port` is a page of the workspace `workspace` resolves to (none when
     * `undefined`). Returns what to call when the port disconnects, which
     * the caller registers at once, before `workspace` resolves.
     */
    add(port: P, workspace: Promise<string | undefined>): () => void {
        void workspace.then((key) => {
            if (key === undefined) return;
            const pages = this.byWorkspace.get(key) ?? new Set<P>();
            pages.add(port);
            this.byWorkspace.set(key, pages);
        });
        // Removed through the same promise, so after the add above, even
        // for a port that went before its workspace was known.
        return () => {
            void workspace.then((key) => {
                if (key === undefined) return;
                const pages = this.byWorkspace.get(key);
                pages?.delete(port);
                if (pages?.size === 0) this.byWorkspace.delete(key);
            });
        };
    }

    /** The pages open on `key` now. */
    of(key: string): readonly P[] {
        return [...(this.byWorkspace.get(key) ?? [])];
    }

    /** Pages held, over all workspaces. */
    get size(): number {
        let total = 0;
        for (const pages of this.byWorkspace.values()) total += pages.size;
        return total;
    }
}
