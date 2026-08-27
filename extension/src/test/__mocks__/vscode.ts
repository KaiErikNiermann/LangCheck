/** Minimal stand-in for the `vscode` module under vitest.
 *
 *  The unit suite runs outside an extension host, so `import * as vscode` in
 *  production code resolves to nothing and takes the whole suite down at import
 *  time. Only the surface the tested modules actually touch is stubbed here —
 *  extend it as tests reach further into the API. */

export const window = {
    showWarningMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
    showErrorMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
    showInformationMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
};

export const l10n = {
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
};
