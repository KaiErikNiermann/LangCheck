/**
 * Reading single values out of a `.languagecheck.*` file.
 *
 * The extension does not parse the whole config -- the core owns that -- but a
 * few keys govern the editor's own behaviour and have to be read here. Kept in
 * a module of its own so they are testable without a VS Code host.
 */

/**
 * How long after the last keystroke a check runs, when the config says nothing.
 *
 * Matches `performance.debounce_ms` in the core's default config; a
 * `.languagecheck.*` that sets it wins.
 */
export const DEFAULT_DEBOUNCE_MS = 500;

/** Read `performance.debounce_ms` out of a YAML config, if it sets one. */
export function parseDebounceMs(content: string): number {
    const match = content.match(/^\s*debounce_ms:\s*(\d+)\s*$/m);
    if (!match?.[1]) return DEFAULT_DEBOUNCE_MS;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DEBOUNCE_MS;
}
