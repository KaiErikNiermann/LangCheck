// The dev build's own reloader: it listens to the build watcher on loopback
// and, when a build other than its own finishes, reloads the extension from
// disk with runtime.reload(), the same path as about:debugging's Reload
// (Firefox) or chrome://extensions' (Chrome, unpacked). It never runs
// anything it is sent: an announcement is a build id, compared with the id
// written into this build.
//
// After a reload, Firefox injects the new content and page scripts into the
// open tabs itself. Chrome leaves the old ones cut off and injects none, so
// there the new background reloads the site tabs once it is up.
import browser from 'webextension-polyfill';
import { DEV_BUILD_FILE, DEV_RELOAD_HOST, DEV_RELOAD_PORT, parseDevBuild } from './protocol';

/**
 * How often the background is kept awake: Firefox suspends an event page
 * with a socket open, and Chrome's worker stays up for socket traffic only
 * when the client sends some at least this often.
 */
export const KEEPALIVE_MS = 20_000;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;
/** Set before a reload in Chrome, for the new background to reload the site tabs. */
const REFRESH_TABS_KEY = 'devRefreshTabs';

/** What the reloader hears from a socket. */
export interface SocketEvents {
    open(): void;
    message(data: unknown): void;
    close(): void;
}

/** The socket as the reloader uses it (a WebSocket). */
export interface DevSocket {
    isOpen(): boolean;
    send(data: string): void;
}

/** What the reloader needs of the browser; real ones in `browserDeps`, fakes in the tests. */
export interface ReloadDeps {
    /** The id written into this build, or undefined when it has none. */
    ownBuild(): Promise<string | undefined>;
    connect(url: string, events: SocketEvents): DevSocket;
    /** Reloads the extension from disk. */
    reload(): void;
    /** Whether the browser injects the new content scripts into open tabs itself (Firefox). */
    readonly reinjects: boolean;
    /** Asks the next background to reload the site tabs. */
    askTabRefresh(): Promise<void>;
    /** Reloads the site tabs if the last background asked to. */
    refreshTabsIfAsked(): Promise<void>;
    /** An extension API call, which keeps an event page from being suspended. */
    keepAwake(): Promise<unknown>;
    setTimer(run: () => void, ms: number): unknown;
    setRepeating(run: () => void, ms: number): unknown;
    log(message: string): void;
}

export function startDevReload(deps: ReloadDeps = browserDeps()): void {
    let own: string | undefined;
    let socket: DevSocket | undefined;
    let retry = RETRY_FIRST_MS;
    let reloading = false;

    const reload = async (to: string): Promise<void> => {
        if (reloading) return;
        reloading = true;
        deps.log(`build ${to} is newer than this one (${own ?? 'none'}): reloading`);
        if (!deps.reinjects) await deps.askTabRefresh();
        deps.reload();
    };

    const connect = (): void => {
        const ws: DevSocket = deps.connect(`ws://${DEV_RELOAD_HOST}:${String(DEV_RELOAD_PORT)}`, {
            open() {
                retry = RETRY_FIRST_MS;
            },
            message(data) {
                const build = parseDevBuild(data);
                // The watcher says which build is current on connect and after
                // each build: a different one is newer than what is running.
                if (build !== undefined && own !== undefined && build.id !== own) void reload(build.id);
            },
            close() {
                if (socket !== ws) return;
                socket = undefined;
                deps.setTimer(connect, retry);
                retry = Math.min(retry * 2, RETRY_MAX_MS);
            },
        });
        socket = ws;
    };

    void (async () => {
        own = await deps.ownBuild();
        if (own === undefined) {
            deps.log(`no ${DEV_BUILD_FILE} in this build: not reloading on rebuilds`);
            return;
        }
        await deps.refreshTabsIfAsked();
        connect();
        deps.setRepeating(() => {
            if (socket?.isOpen() === true) socket.send('ping');
            void deps.keepAwake();
        }, KEEPALIVE_MS);
    })();
}

/** The site tabs: those the content scripts run in, by the manifest's own matches. */
function siteMatches(): string[] {
    return (browser.runtime.getManifest().content_scripts ?? []).flatMap((script) => script.matches);
}

function browserDeps(): ReloadDeps {
    return {
        async ownBuild() {
            try {
                const response = await fetch(browser.runtime.getURL(DEV_BUILD_FILE));
                const body = (await response.json()) as { id?: unknown };
                return typeof body.id === 'string' ? body.id : undefined;
            } catch {
                // Not a dev build after all, or a file that is not JSON.
                return;
            }
        },
        connect(url, events) {
            const ws = new WebSocket(url);
            ws.addEventListener('open', () => {
                events.open();
            });
            ws.addEventListener('message', (event: MessageEvent) => {
                events.message(event.data);
            });
            // An error is followed by a close, which is where the retry is.
            ws.addEventListener('close', () => {
                events.close();
            });
            return { isOpen: () => ws.readyState === WebSocket.OPEN, send: (data) => { ws.send(data); } };
        },
        reload: () => {
            browser.runtime.reload();
        },
        // Only Firefox has getBrowserInfo; it is also the one that re-injects.
        reinjects: 'getBrowserInfo' in browser.runtime,
        async askTabRefresh() {
            await browser.storage.local.set({ [REFRESH_TABS_KEY]: true });
        },
        async refreshTabsIfAsked() {
            const stored = await browser.storage.local.get(REFRESH_TABS_KEY);
            if (stored[REFRESH_TABS_KEY] !== true) return;
            await browser.storage.local.remove(REFRESH_TABS_KEY);
            const tabs = await browser.tabs.query({ url: siteMatches() });
            await Promise.all(tabs.flatMap((tab) => (tab.id === undefined ? [] : [browser.tabs.reload(tab.id)])));
        },
        keepAwake: () => browser.runtime.getPlatformInfo(),
        setTimer: (run, ms) => setTimeout(run, ms),
        setRepeating: (run, ms) => setInterval(run, ms),
        log: (message) => {
            console.info(`[language-check dev] ${message}`);
        },
    };
}
