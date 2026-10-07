// Keys typed while the palette is opening. Between the binding and the
// palette's search box taking focus there is a gap (the iframe loads, then
// focuses); keys typed in it would otherwise reach the page -- the site's
// editor, where they become text in the user's document. Both sides of the
// palette hold the keyboard through that gap and keep what was typed, which
// becomes the start of the search.

/** The longest search kept from the gap: anything longer is not a command name. */
export const MAX_TYPED_CHARS = 100;

/** What one keydown means to a search being typed. Escape and the palette's binding both close it; Enter submits it. */
export type TypedKey =
    | { readonly kind: 'char'; readonly char: string }
    | { readonly kind: 'backspace' }
    | { readonly kind: 'close' }
    | { readonly kind: 'submit' }
    | { readonly kind: 'other' };

type KeyFields = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>;

/** `text` as code points: splitting there is the point, so an astral character stays whole. */
// eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are what is wanted
const codePoints = (text: string): string[] => [...text];

type Flag = 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey';
const FLAGS: readonly Flag[] = ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'];

/** hotkeys-js's modifier names, by the event flag each one means. */
const MODIFIERS: ReadonlyMap<string, Flag> = new Map([
    ['ctrl', 'ctrlKey'],
    ['control', 'ctrlKey'],
    ['⌃', 'ctrlKey'],
    ['cmd', 'metaKey'],
    ['command', 'metaKey'],
    ['⌘', 'metaKey'],
    ['alt', 'altKey'],
    ['option', 'altKey'],
    ['⌥', 'altKey'],
    ['shift', 'shiftKey'],
    ['⇧', 'shiftKey'],
]);

/** The physical key a one-letter or one-digit key name means (KeyboardEvent.code), so Shift or the layout does not change it. */
function physicalCode(key: string): string | undefined {
    if (/^[a-z]$/u.test(key)) return `Key${key.toUpperCase()}`;
    if (/^\d$/u.test(key)) return `Digit${key}`;
    return undefined;
}

/** Whether `event` is `binding`, in hotkeys-js notation (`ctrl+p`, `ctrl+shift+l`, alternatives separated by `,`). */
export function isBinding(binding: string, event: KeyFields): boolean {
    return binding.split(',').some((alternative) => {
        const parts = alternative.trim().toLowerCase().split('+');
        const key = parts.pop() ?? '';
        const wanted = new Set<Flag | undefined>(parts.map((part) => MODIFIERS.get(part)));
        if (key === '' || wanted.has(undefined) || FLAGS.some((flag) => event[flag] !== wanted.has(flag))) return false;
        const code = physicalCode(key);
        return code === undefined ? event.key.toLowerCase() === key : event.code === code;
    });
}

export function typedKey(event: KeyFields, binding = ''): TypedKey {
    if (event.isComposing) return { kind: 'other' };
    if (event.key === 'Escape' || (binding !== '' && isBinding(binding, event))) return { kind: 'close' };
    if (event.key === 'Backspace') return { kind: 'backspace' };
    if (event.key === 'Enter') return { kind: 'submit' };
    // One character (one code point: an astral one is two UTF-16 units), with
    // no command modifier. Alt stays allowed: AltGr types characters.
    if (!event.ctrlKey && !event.metaKey && codePoints(event.key).length === 1) return { kind: 'char', char: event.key };
    return { kind: 'other' };
}

/** `text` after `key`, kept within MAX_TYPED_CHARS. */
export function applyTyped(text: string, key: TypedKey): string {
    switch (key.kind) {
        case 'char':
            return text.length >= MAX_TYPED_CHARS ? text : text + key.char;
        case 'backspace':
            return codePoints(text).slice(0, -1).join('');
        default:
            return text;
    }
}

function swallow(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
}

const CAPTURE = { capture: true } as const;
const SWALLOWED = ['keypress', 'keyup', 'beforeinput', 'input'] as const;

/**
 * Holds the keyboard of `target` (in the capture phase, ahead of anything
 * the page registered): no key reaches the page, typed text is collected,
 * Escape or `binding` calls `onClose`. Enter submits what was typed: keys
 * after it are dropped. Returns what was typed so far, whether it was
 * submitted, and the release.
 */
export function holdKeys(target: Window, binding: string, onClose: () => void): { typed(): string; submitted(): boolean; release(): void } {
    let text = '';
    let submitted = false;
    const onKeyDown = (event: KeyboardEvent): void => {
        swallow(event);
        const key = typedKey(event, binding);
        if (key.kind === 'close') onClose();
        else if (key.kind === 'submit') submitted = true;
        else if (!submitted) text = applyTyped(text, key);
    };
    target.addEventListener('keydown', onKeyDown, CAPTURE);
    for (const type of SWALLOWED) target.addEventListener(type, swallow, CAPTURE);
    return {
        typed: () => text,
        submitted: () => submitted,
        release: () => {
            target.removeEventListener('keydown', onKeyDown, CAPTURE);
            for (const type of SWALLOWED) target.removeEventListener(type, swallow, CAPTURE);
        },
    };
}
