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

export class WorkspaceConfigState {
    /**
     * The config file as last seen, so any edit to it triggers a re-check.
     *
     * Watching only `spell_language` left the rest of the file able to change
     * behind the results: a new dictionary, a disabled rule or a different
     * engine silently applied to the next document checked and not to the one
     * on screen, and the inspector went on reporting what the previous config
     * produced.
     *
     * Three states, and the third is the one that needed spelling out: a
     * string is the file's contents, `null` is "there is no config file", and
     * `undefined` is "not looked yet". Without `null`, deleting the config was
     * indistinguishable from never having read one, so the editor went on
     * checking under a config that no longer existed.
     */
    text: string | null | undefined;
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
