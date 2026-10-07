// The extension's own pages (panels, the config page) keep the background
// running while they are open. An MV3 background is stopped after about
// 30 s without events, and the native connection that otherwise keeps it
// up closes after a long idle; a panel tab would then lose its port and
// close itself, and a config page its unsaved state's link. A message on
// the page's port is an event, so one now and then is enough.

export const KEEPALIVE_TYPE = 'keepalive';
/** Comfortably inside the background's idle limit. */
export const KEEPALIVE_MS = 20_000;

export const isKeepalive = (message: unknown): boolean => (message as { type?: unknown } | null)?.type === KEEPALIVE_TYPE;

/** Posts a keepalive on the page's current port (if it has one) every KEEPALIVE_MS, for as long as the page is open. */
export function keepBackgroundAlive(port: () => { postMessage(message: unknown): void } | undefined): void {
    setInterval(() => {
        try {
            port()?.postMessage({ type: KEEPALIVE_TYPE });
        } catch {
            // The port closed meanwhile: the page reconnects or closes on its own.
        }
    }, KEEPALIVE_MS);
}
