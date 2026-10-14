// "Exclude Current File" for a site's document: its path goes into the
// workspace config's `exclude`, edited as VS Code's command edits it. The
// background does it, not the page: the config is the extension's to read
// and write (a page may not see it, it can hold an API key), and the page
// only names its document.
import { addExclude, globEscape } from '../../../extension/src/config/edits';
import type { ConfigRequest } from '../messaging/config';
import type { PageResponse } from '../messaging/protocol';

/** What an exclude answers a page: the pattern written, and whether it was there already. */
export interface Excluded {
    readonly pattern: string;
    readonly already: boolean;
}

/** Asks the workspace's core for the config, answering as it answers a page (fixed sentences for failures). */
export type AskConfig = (request: ConfigRequest) => Promise<PageResponse>;

/**
 * Runs each workspace's tasks one after another: an exclude reads the
 * config, edits it and writes it, so two at once (two tabs on one project)
 * would each write over the other's. Settled queues are dropped.
 */
export function perWorkspace(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
    const queues = new Map<string, Promise<unknown>>();
    return <T>(key: string, task: () => Promise<T>): Promise<T> => {
        const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
        const settled = run.then(
            () => {},
            () => {},
        );
        queues.set(key, settled);
        void settled.then(() => {
            if (queues.get(key) === settled) queues.delete(key);
        });
        return run;
    };
}

/** What a page is told when the config is not one this can edit. */
export const CONFIG_NOT_EDITABLE = 'The config could not be read, so nothing was excluded; open Edit Config to see why.';

/**
 * Adds `path`, glob-escaped so it matches only itself, to the config's
 * `exclude`, and writes it. `changed` runs after a write (the core
 * re-reads the config, the pages check again). Answers under `id`.
 */
export async function excludeDocument(id: number, path: string, ask: AskConfig, changed: () => Promise<void>): Promise<PageResponse> {
    const read = await ask({ readConfig: {} });
    if (!read.ok) return { ...read, id };
    const config = read.response.readConfig as { text?: unknown } | undefined;
    const pattern = globEscape(path);
    let edit: { content: string; alreadyExcluded: boolean };
    try {
        edit = addExclude(typeof config?.text === 'string' ? config.text : '', pattern);
    } catch {
        return { id, ok: false, code: 'failed', error: CONFIG_NOT_EDITABLE };
    }
    const excluded: Excluded = { pattern, already: edit.alreadyExcluded };
    if (edit.alreadyExcluded) return { id, ok: true, response: { excluded } };
    const write = await ask({ writeConfig: { text: edit.content } });
    if (!write.ok) return { ...write, id };
    await changed();
    return { id, ok: true, response: { excluded } };
}
