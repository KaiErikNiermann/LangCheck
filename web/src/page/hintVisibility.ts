// Whether the suggestion hints show, from the options page's mode and
// whether Ctrl+Alt is held, as VS Code's `editor.inlayHints.enabled` does.
import type { InlayHintsMode } from '../messaging/protocol';

/** Whether hints show under `mode` while Ctrl+Alt is `pressed` or not. */
export function hintsVisible(mode: InlayHintsMode, pressed: boolean): boolean {
    switch (mode) {
        case 'on':
            return true;
        case 'off':
            return false;
        case 'onUnlessPressed':
            return !pressed;
        case 'offUnlessPressed':
            return pressed;
    }
}

type KeyState = Pick<KeyboardEvent, 'ctrlKey' | 'altKey'>;
const held = (event: KeyState): boolean => event.ctrlKey && event.altKey;

/**
 * Follows Ctrl+Alt on `target` and calls `changed` when it is pressed or
 * let go (or the window loses focus, which lets go of it). Returns the stop.
 */
export function followHintKeys(target: Window, changed: (pressed: boolean) => void): () => void {
    let pressed = false;
    const set = (now: boolean): void => {
        if (now === pressed) return;
        pressed = now;
        changed(now);
    };
    const onKey = (event: KeyboardEvent): void => {
        set(held(event));
    };
    const onBlur = (): void => {
        set(false);
    };
    const options = { capture: true } as const;
    target.addEventListener('keydown', onKey, options);
    target.addEventListener('keyup', onKey, options);
    target.addEventListener('blur', onBlur);
    return () => {
        target.removeEventListener('keydown', onKey, options);
        target.removeEventListener('keyup', onKey, options);
        target.removeEventListener('blur', onBlur);
    };
}
