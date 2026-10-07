// The palette's host in the content script: listens for the binding, puts
// the palette's extension page over the site in an iframe, and runs what was
// chosen. hotkeys-js does the key parsing; its default filter ignores keys
// typed into editable elements, which is exactly where users are, so it is
// widened to everything here (this world's hotkeys instance is ours alone).
import hotkeys from 'hotkeys-js';
import browser from 'webextension-polyfill';
import { PALETTE, isPaletteCommand, type PaletteCommandId } from './commands';
import { DEFAULT_PALETTE_HOTKEY, PALETTE_HOTKEY_KEY, PALETTE_INIT_TYPE, type PaletteToContent } from './protocol';

/** The top of the stacking order: the palette sits over the site's own overlays. */
const TOP_LAYER_Z = '2147483647';
/** How long a closed palette's iframe lingers, hidden, before it is removed. */
const REMOVE_AFTER_MS = 250;

/** Starts listening for the palette's binding; `run` gets the command the user chose. */
export function startPalette(run: (id: PaletteCommandId) => void): void {
    let frame: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
    let returnFocus: Element | null = null;
    let binding = DEFAULT_PALETTE_HOTKEY;

    const close = (): void => {
        port?.close();
        port = undefined;
        // Hidden at once, removed once the key that closed it has been handled:
        // the iframe is an out-of-process frame, and destroying it while it is
        // still dispatching that key leaves the browser's input acknowledgement
        // hanging.
        const closing = frame;
        if (closing !== undefined) {
            closing.style.display = 'none';
            setTimeout(() => {
                closing.remove();
            }, REMOVE_AFTER_MS);
        }
        frame = undefined;
        // Back to where the user was typing.
        if (returnFocus instanceof HTMLElement) returnFocus.focus();
        returnFocus = null;
    };

    const connect = (opened: HTMLIFrameElement): void => {
        const channel = new MessageChannel();
        channel.port1.addEventListener('message', (event: MessageEvent) => {
            const message = event.data as Partial<PaletteToContent> | null;
            if (message?.type === 'close') close();
            else if (message?.type === 'run' && isPaletteCommand(message.id)) {
                const id = message.id;
                close();
                run(id);
            }
        });
        channel.port1.start();
        port = channel.port1;
        // Addressed to the extension's origin: the site cannot receive the port.
        const origin = new URL(browser.runtime.getURL('')).origin;
        opened.contentWindow?.postMessage({ type: PALETTE_INIT_TYPE, ids: PALETTE.map((entry) => entry.id), hotkey: binding }, origin, [channel.port2]);
        opened.focus();
    };

    const open = (): void => {
        if (frame !== undefined) return;
        returnFocus = document.activeElement;
        const created = document.createElement('iframe');
        created.src = browser.runtime.getURL('palette.html');
        created.title = 'Language Check commands';
        Object.assign(created.style, {
            position: 'fixed',
            inset: '0',
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            zIndex: TOP_LAYER_Z,
            colorScheme: 'normal',
        });
        created.addEventListener(
            'load',
            () => {
                connect(created);
            },
            { once: true },
        );
        document.documentElement.append(created);
        frame = created;
    };

    const rebind = (value: unknown): void => {
        hotkeys.unbind(binding);
        binding = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_PALETTE_HOTKEY;
        hotkeys(binding, (event) => {
            event.preventDefault();
            if (frame === undefined) open();
            else close();
            return false;
        });
    };

    hotkeys.filter = () => true;
    rebind(undefined);
    void browser.storage.local.get(PALETTE_HOTKEY_KEY).then(
        (stored) => {
            rebind(stored[PALETTE_HOTKEY_KEY]);
        },
        () => {},
    );
    browser.storage.onChanged.addListener((changes, area) => {
        const change = changes[PALETTE_HOTKEY_KEY];
        if (area === 'local' && change !== undefined) rebind(change.newValue);
    });
}
