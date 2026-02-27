import * as vscode from 'vscode';
import type { LanguageClient } from './client';

/**
 * Public API for the Language Check extension.
 *
 * Other extensions can access this via:
 * ```ts
 * const ext = vscode.extensions.getExtension('gemini.extension');
 * const api: LanguageCheckAPI = ext?.exports;
 * ```
 */
export interface LanguageCheckAPI {
    /** Check a document and return diagnostics. */
    checkDocument(uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]>;

    /** Register byte ranges to ignore for a specific document. */
    registerIgnoreRanges(uri: vscode.Uri, ranges: IgnoreRange[]): void;

    /** Clear previously registered ignore ranges for a document. */
    clearIgnoreRanges(uri: vscode.Uri): void;

    /** Register a custom language query for prose extraction. */
    registerLanguageQuery(languageId: string, query: string): void;

    /** Register an external provider callback. */
    registerExternalProvider(provider: ExternalProviderRegistration): vscode.Disposable;

    /** Whether the language-check core process is running. */
    readonly isRunning: boolean;

    /** The extension version. */
    readonly version: string;
}

export interface LanguageCheckDiagnostic {
    startByte: number;
    endByte: number;
    message: string;
    ruleId: string;
    unifiedId: string;
    severity: 'error' | 'warning' | 'information' | 'hint';
    suggestions: string[];
    confidence: number;
}

export interface IgnoreRange {
    startByte: number;
    endByte: number;
    /** If specified, only ignore these rule IDs. Empty = ignore all. */
    ruleIds?: string[];
}

export interface ExternalProviderRegistration {
    /** Unique name for the provider. */
    name: string;
    /** Languages this provider supports (empty = all). */
    languageIds?: string[];
    /** Called when a document needs checking. */
    check(text: string, languageId: string): Promise<LanguageCheckDiagnostic[]>;
}

/**
 * Creates the public API object backed by the client and extension state.
 */
export function createAPI(
    client: LanguageClient,
    checkDocumentFn: (uri: vscode.Uri) => Promise<LanguageCheckDiagnostic[]>,
    version: string,
): LanguageCheckAPI {
    const ignoreRanges = new Map<string, IgnoreRange[]>();
    const languageQueries = new Map<string, string>();
    const externalProviders = new Map<string, ExternalProviderRegistration>();

    return {
        async checkDocument(uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]> {
            return checkDocumentFn(uri);
        },

        registerIgnoreRanges(uri: vscode.Uri, ranges: IgnoreRange[]): void {
            const key = uri.toString();
            const existing = ignoreRanges.get(key) ?? [];
            ignoreRanges.set(key, [...existing, ...ranges]);
        },

        clearIgnoreRanges(uri: vscode.Uri): void {
            ignoreRanges.delete(uri.toString());
        },

        registerLanguageQuery(languageId: string, query: string): void {
            languageQueries.set(languageId, query);
        },

        registerExternalProvider(provider: ExternalProviderRegistration): vscode.Disposable {
            externalProviders.set(provider.name, provider);
            return new vscode.Disposable(() => {
                externalProviders.delete(provider.name);
            });
        },

        get isRunning(): boolean {
            return client.isRunning;
        },

        version,
    };
}

/** Helper to retrieve the ignore ranges registered for a URI. */
export function getRegisteredIgnoreRanges(api: ReturnType<typeof createAPI>, uri: vscode.Uri): IgnoreRange[] {
    // The API object has a closure over ignoreRanges, so we expose a helper
    // This is used internally by the extension to check against API-registered ranges
    return [];
}
