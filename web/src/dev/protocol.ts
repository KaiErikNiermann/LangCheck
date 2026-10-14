// What the dev build's watcher and the dev extension say to each other: the
// watcher announces each finished build by an id, and an extension running
// another build reloads itself from disk (runtime.reload). Dev builds only
// (`node esbuild.mjs --dev`, into dist-dev/); the release build refuses to
// contain any of it (esbuild.mjs).

/** Where the watcher listens: loopback only. */
export const DEV_RELOAD_HOST = '127.0.0.1';
export const DEV_RELOAD_PORT = 35_817;

/** The file in the dev build naming the build it is; written last, after everything else. */
export const DEV_BUILD_FILE = 'dev-build.json';

/** Ids the watcher makes: a timestamp and a counter, nothing a page could inject. */
const BUILD_ID = /^[0-9a-z-]{1,64}$/u;

/** A finished build, as the watcher announces it. */
export interface DevBuild {
    readonly type: 'build';
    readonly id: string;
}

/** `text` as an announcement, or undefined: anything else on the socket is ignored. */
export function parseDevBuild(text: unknown): DevBuild | undefined {
    if (typeof text !== 'string' || text.length > 256) return undefined;
    try {
        const value = JSON.parse(text) as { type?: unknown; id?: unknown } | null;
        return value?.type === 'build' && typeof value.id === 'string' && BUILD_ID.test(value.id) ? { type: 'build', id: value.id } : undefined;
    } catch {
        return undefined;
    }
}

/** The content of DEV_BUILD_FILE. */
export function devBuildFile(id: string): string {
    return `${JSON.stringify({ id })}\n`;
}

/** Whether `origin` is an extension's (only extensions may listen to the watcher, never a web page). */
export function isExtensionOrigin(origin: string | undefined): boolean {
    return origin !== undefined && /^(?:moz|chrome)-extension:\/\/[0-9a-z-]{1,64}$/u.test(origin);
}
