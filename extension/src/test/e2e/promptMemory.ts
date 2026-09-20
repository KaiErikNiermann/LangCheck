/**
 * Catching the install offer without a human to click it.
 *
 * The tests and the extension share one extension host, and so one `vscode`
 * module. Replacing `window.showInformationMessage` here is therefore the same
 * function the extension calls, which is the only way to answer a modal from a
 * test -- there is no API for pressing a notification button.
 */
import * as vscode from 'vscode';

export interface RecordedPrompt {
    message: string;
    items: string[];
}

export interface PromptRecorder {
    /** Every information message raised since the recorder was installed. */
    readonly seen: RecordedPrompt[];
    /** Prompts whose text names a language tag, which the pack offer does. */
    forLanguage(tag: string): RecordedPrompt[];
    /** Put the real function back. Always call it, or later tests inherit this. */
    restore(): void;
}

/**
 * Record every information message, answering each with `answer`.
 *
 * `answer` is matched against the buttons offered and returned if present, so
 * a test says which button it pressed rather than relying on position.
 * Returning `undefined` is a dismissed notification, which the extension
 * treats as "not now".
 */
export function recordPrompts(answer?: string): PromptRecorder {
    const seen: RecordedPrompt[] = [];
    const original = vscode.window.showInformationMessage;

    // The overloads differ in whether options come second; the pack offer uses
    // the plain (message, ...items) form, and anything else is passed through.
    const replacement = (message: string, ...rest: unknown[]) => {
        const items = rest.filter((r): r is string => typeof r === 'string');
        seen.push({ message, items });
        if (answer !== undefined && items.includes(answer)) {
            return Promise.resolve(answer);
        }
        return Promise.resolve(undefined);
    };

    (vscode.window as unknown as Record<string, unknown>).showInformationMessage = replacement;

    return {
        seen,
        forLanguage: (tag: string) => seen.filter(p => p.message.includes(tag)),
        restore: () => {
            (vscode.window as unknown as Record<string, unknown>)
                .showInformationMessage = original;
        },
    };
}

/**
 * Record every warning notification, dismissing each.
 *
 * Separate from [`recordPrompts`] because the extension raises its engine
 * failures through `showWarningMessage` and its offers through
 * `showInformationMessage`, and a test watching for one must not swallow the
 * other.
 */
export function recordWarnings(): PromptRecorder {
    const seen: RecordedPrompt[] = [];
    const original = vscode.window.showWarningMessage;

    const replacement = (message: string, ...rest: unknown[]) => {
        seen.push({ message, items: rest.filter((r): r is string => typeof r === 'string') });
        return Promise.resolve(undefined);
    };

    (vscode.window as unknown as Record<string, unknown>).showWarningMessage = replacement;

    return {
        seen,
        forLanguage: (tag: string) => seen.filter(p => p.message.includes(tag)),
        restore: () => {
            (vscode.window as unknown as Record<string, unknown>)
                .showWarningMessage = original;
        },
    };
}
