/**
 * What the extension itself reads out of `.languagecheck.yaml`.
 *
 * The core reads the whole config; the extension needs a few values for work it
 * does on its own side: which LaTeX names the inlay hints leave alone, how long
 * to wait after a keystroke, and the text itself, to tell what kind of change
 * an edit was.
 */
import {
    DEFAULT_DEBOUNCE_MS,
    parseDebounceMs,
    parseProseEnvironments,
    parseSkipCommands,
    parseSkipEnvironments,
} from './parsing';

/**
 * The config file as last seen.
 *
 * Three states, and the third is the one that needed spelling out: `present`
 * holds the file's contents, `absent` is "there is no config file", and
 * `unread` is "not looked yet". Without `absent`, deleting the config was
 * indistinguishable from never having read one, so the editor went on checking
 * under a config that no longer existed. As a tagged union the two cannot be
 * mixed up, and a caller cannot reach the text without first establishing that
 * there is one.
 */
export type SeenConfig =
    | { readonly state: 'unread' }
    | { readonly state: 'absent' }
    | { readonly state: 'present'; readonly text: string };

export class WorkspaceConfigState {
    /**
     * The config file as last seen, so any edit to it triggers a re-check.
     *
     * Watching only `spell_language` left the rest of the file able to change
     * behind the results: a new dictionary, a disabled rule or a different
     * engine silently applied to the next document checked and not to the one
     * on screen, and the inspector went on reporting what the previous config
     * produced.
     */
    seen: SeenConfig = { state: 'unread' };
    /** User-configured `skip_environments`. */
    skipEnvironments = new Set<string>();
    /** User-configured `prose_environments`: inlay hints suppressed, checking kept. */
    proseEnvironments = new Set<string>();
    /** User-configured `skip_commands`. */
    skipCommands = new Set<string>();
    /** Check-on-change debounce. */
    debounceMs = DEFAULT_DEBOUNCE_MS;

    /** Take the values the extension uses from the config's text. */
    apply(raw: string): void {
        this.skipEnvironments = parseSkipEnvironments(raw);
        this.skipCommands = parseSkipCommands(raw);
        this.proseEnvironments = parseProseEnvironments(raw);
        this.debounceMs = parseDebounceMs(raw);
    }

    /** Back to the defaults, for a workspace with no config file. */
    reset(): void {
        this.skipEnvironments = new Set<string>();
        this.skipCommands = new Set<string>();
        this.proseEnvironments = new Set<string>();
        this.debounceMs = DEFAULT_DEBOUNCE_MS;
    }
}
