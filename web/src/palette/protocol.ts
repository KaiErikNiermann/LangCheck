// Messages between the content script and the palette iframe.

export const PALETTE_INIT_TYPE = 'language-check:palette-init';

export type PaletteToContent = { readonly type: 'run'; readonly id: string } | { readonly type: 'close' };

/** The default binding, in hotkeys-js notation; users can change it on the options page. */
export const DEFAULT_PALETTE_HOTKEY = 'ctrl+p';

/** Where the binding is stored (browser.storage.local). */
export const PALETTE_HOTKEY_KEY = 'paletteHotkey';
