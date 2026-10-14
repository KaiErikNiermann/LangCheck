// The palette's theme: the system's light or dark by default, or one the
// user picked, kept in browser.storage.local. palette.css draws both from
// one token table; this only says which applies.

/** Where the choice is stored (browser.storage.local). */
export const PALETTE_THEME_KEY = 'paletteTheme';

export const PALETTE_THEMES = ['system', 'light', 'dark'] as const;
export type PaletteTheme = (typeof PALETTE_THEMES)[number];

export const PALETTE_THEME_TITLES: Readonly<Record<PaletteTheme, string>> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
};

/** `value` as a theme; anything else (nothing stored, a bad value) is the system's. */
export function parseTheme(value: unknown): PaletteTheme {
    return PALETTE_THEMES.find((theme) => theme === value) ?? 'system';
}

/** Applies `theme` to the page whose root is `root`: palette.css reads `data-theme`. */
export function applyTheme(root: HTMLElement, theme: PaletteTheme): void {
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
}
