// The options page: the one setting so far, the palette's shortcut.
import browser from 'webextension-polyfill';
import { DEFAULT_PALETTE_HOTKEY, PALETTE_HOTKEY_KEY } from '../palette/protocol';
import { parseBinding } from '../palette/typing';

const form = document.querySelector<HTMLFormElement>('#form');
const input = document.querySelector<HTMLInputElement>('#hotkey');
const status = document.querySelector<HTMLElement>('#status');

if (form !== null && input !== null && status !== null) {
    void browser.storage.local.get(PALETTE_HOTKEY_KEY).then((stored) => {
        const value = stored[PALETTE_HOTKEY_KEY];
        input.value = typeof value === 'string' ? value : '';
    });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const typed = input.value.trim();
        // Empty: back to the default.
        const value = typed === '' ? '' : parseBinding(typed);
        if (value === undefined) {
            status.textContent = `"${typed}" cannot be the shortcut: it needs Ctrl, Alt or Cmd (or a function key), and must not be one an editor uses, such as Ctrl+C or Ctrl+S.`;
            return;
        }
        void browser.storage.local.set({ [PALETTE_HOTKEY_KEY]: value }).then(() => {
            status.textContent = `Saved. The palette opens with ${value === '' ? DEFAULT_PALETTE_HOTKEY : value}.`;
        });
    });
}
