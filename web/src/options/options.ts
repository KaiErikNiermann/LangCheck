// The options page: the one setting so far, the palette's shortcut.
import browser from 'webextension-polyfill';
import { DEFAULT_PALETTE_HOTKEY, PALETTE_HOTKEY_KEY } from '../palette/protocol';

/** hotkeys-js notation: modifiers and one key joined by "+", several bindings by ",". */
const HOTKEY = /^(?:(?:ctrl|shift|alt|cmd|meta|option)\+)*(?:[a-z0-9]|f(?:[1-9]|1[0-2])|[.,/;'=`[\]\\-])$/iu;

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
        const value = input.value.trim().toLowerCase();
        const bindings = value === '' ? [] : value.split(',').map((b) => b.trim());
        if (bindings.some((b) => !HOTKEY.test(b))) {
            status.textContent = `"${value}" is not a shortcut hotkeys-js understands.`;
            return;
        }
        void browser.storage.local.set({ [PALETTE_HOTKEY_KEY]: value }).then(() => {
            status.textContent = `Saved. The palette opens with ${value === '' ? DEFAULT_PALETTE_HOTKEY : value}.`;
        });
    });
}
