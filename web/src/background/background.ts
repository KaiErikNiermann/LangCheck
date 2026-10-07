// The extension's background (service worker in Chrome, event page in
// Firefox). Content scripts connect over a runtime port; each request is
// re-parsed and handed to the native connection of the workspace the
// browser says the sending tab is on.
import browser, { type Runtime } from 'webextension-polyfill';
import { BACKGROUND_PORT_NAME, parseBackgroundRequest, type BackgroundResponse } from '../messaging/background';
import { workspaceForUrl } from '../sites/registry';
import { CoreManager, IDLE_CLOSE_MS } from './nativeCore';

const cores = new CoreManager((host) => browser.runtime.connectNative(host));
setInterval(() => { cores.sweep(); }, IDLE_CLOSE_MS / 4);

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
    // Only our own content scripts, in a tab on a project page of a known
    // site. The workspace is fixed here, from what the browser reports.
    const key = workspaceForUrl(port.sender?.url);
    if (key === undefined || port.name !== BACKGROUND_PORT_NAME || port.sender?.id !== browser.runtime.id || port.sender.tab === undefined) {
        port.disconnect();
        return;
    }
    port.onMessage.addListener((message: unknown) => {
        const parsed = parseBackgroundRequest(message);
        if (parsed === undefined) return;
        void cores.request(key, parsed.request).then((response) => {
            const reply: BackgroundResponse = { id: parsed.id, response };
            try {
                port.postMessage(reply);
            } catch {
                // The tab went away while the core was answering.
            }
        });
    });
});
