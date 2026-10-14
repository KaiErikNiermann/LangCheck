// The options page: the palette's shortcut, how long documents are checked,
// and what becomes of a site's own spellchecker.
import browser from 'webextension-polyfill';
import { CHECK_SETTINGS_KEY, parseCheckSettings, WINDOW_BYTES_RANGE } from '../messaging/protocol';
import { DEFAULT_PALETTE_HOTKEY, PALETTE_HOTKEY_KEY } from '../palette/protocol';
import { parseBinding } from '../palette/typing';

/** What a failed read or write of the extension's storage tells the user. */
const storageFailed = (doing: string, error: unknown): string => {
    console.warn(`[language-check] ${doing}:`, error);
    return `Could not ${doing}: ${error instanceof Error ? error.message : String(error)}`;
};

const form = document.querySelector<HTMLFormElement>('#form');
const input = document.querySelector<HTMLInputElement>('#hotkey');
const status = document.querySelector<HTMLElement>('#status');

if (form !== null && input !== null && status !== null) {
    void browser.storage.local.get(PALETTE_HOTKEY_KEY).then(
        (stored) => {
            const value = stored[PALETTE_HOTKEY_KEY];
            input.value = typeof value === 'string' ? value : '';
        },
        (error: unknown) => {
            status.textContent = storageFailed('read the saved shortcut', error);
        },
    );
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const typed = input.value.trim();
        // Empty: back to the default.
        const value = typed === '' ? '' : parseBinding(typed);
        if (value === undefined) {
            status.textContent = `"${typed}" cannot be the shortcut: it needs Ctrl, Alt or Cmd (or a function key), and must not be one an editor uses, such as Ctrl+C or Ctrl+S, or a browser one, such as Ctrl+P.`;
            return;
        }
        void browser.storage.local.set({ [PALETTE_HOTKEY_KEY]: value }).then(
            () => {
                status.textContent = `Saved. The palette opens with ${value === '' ? DEFAULT_PALETTE_HOTKEY : value}.`;
            },
            (error: unknown) => {
                status.textContent = storageFailed('save the shortcut', error);
            },
        );
    });
}

const KIB = 1024;
const checking = document.querySelector<HTMLFormElement>('#checking');
const progressive = document.querySelector<HTMLInputElement>('#progressive');
const windowKib = document.querySelector<HTMLInputElement>('#window-kib');
const maxKib = document.querySelector<HTMLInputElement>('#max-kib');
const checkingStatus = document.querySelector<HTMLElement>('#checking-status');

if (checking !== null && progressive !== null && windowKib !== null && maxKib !== null && checkingStatus !== null) {
    const show = (value: unknown): void => {
        const settings = parseCheckSettings(value);
        progressive.checked = settings.progressive;
        windowKib.value = String(Math.round(settings.windowBytes / KIB));
        maxKib.value = String(Math.round(settings.maxBytes / KIB));
        for (const radio of checking.querySelectorAll<HTMLInputElement>('input[name="foreign"]')) radio.checked = radio.value === settings.foreignCheckers;
    };
    show(undefined);
    void browser.storage.local.get(CHECK_SETTINGS_KEY).then(
        (stored) => {
            show(stored[CHECK_SETTINGS_KEY]);
        },
        (error: unknown) => {
            checkingStatus.textContent = storageFailed('read the saved checking options', error);
        },
    );
    checking.addEventListener('submit', (event) => {
        event.preventDefault();
        const windowBytes = Number(windowKib.value) * KIB;
        const maxBytes = Number(maxKib.value) * KIB;
        if (!Number.isSafeInteger(windowBytes) || windowBytes < WINDOW_BYTES_RANGE.min || windowBytes > WINDOW_BYTES_RANGE.max) {
            checkingStatus.textContent = `The window size must be a whole number of KiB from ${String(WINDOW_BYTES_RANGE.min / KIB)} to ${String(WINDOW_BYTES_RANGE.max / KIB)}.`;
            return;
        }
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
            checkingStatus.textContent = 'The most to check must be a whole number of KiB, or 0 for all of it.';
            return;
        }
        const foreignCheckers = checking.querySelector<HTMLInputElement>('input[name="foreign"]:checked')?.value;
        const settings = parseCheckSettings({ progressive: progressive.checked, windowBytes, maxBytes, foreignCheckers });
        void browser.storage.local.set({ [CHECK_SETTINGS_KEY]: settings }).then(
            () => {
                checkingStatus.textContent = 'Saved. Pages check under it from their next check.';
            },
            (error: unknown) => {
                checkingStatus.textContent = storageFailed('save the checking options', error);
            },
        );
    });
}
