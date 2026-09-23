import * as vscode from 'vscode';
import type { LanguageClient } from './core/client';
import type { CoreService } from './core/coreService';
import { languagecheck } from './proto/checker';
import { uriKey, type UriKey } from './shared/documents';

/**
 * Public API for the Language Check extension.
 *
 * Other extensions can access this via:
 * ```ts
 * const ext = vscode.extensions.getExtension('KaiErikNiermann.extension');
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
 *
 * `currentClient` is asked on every use: a restart replaces the client, and
 * activation may finish with none at all (no local build, a failed download).
 */
export function createAPI(
    currentClient: () => LanguageClient | null,
    checkDocumentFn: (uri: vscode.Uri) => Promise<LanguageCheckDiagnostic[]>,
    version: string,
): LanguageCheckAPI {
    const ignoreRanges = new Map<UriKey, IgnoreRange[]>();
    const languageQueries = new Map<string, string>();
    const externalProviders = new Map<string, ExternalProviderRegistration>();

    return {
        async checkDocument(uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]> {
            return checkDocumentFn(uri);
        },

        registerIgnoreRanges(uri: vscode.Uri, ranges: IgnoreRange[]): void {
            const key = uriKey(uri);
            const existing = ignoreRanges.get(key) ?? [];
            ignoreRanges.set(key, [...existing, ...ranges]);
        },

        clearIgnoreRanges(uri: vscode.Uri): void {
            ignoreRanges.delete(uriKey(uri));
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
            return currentClient()?.isRunning ?? false;
        },

        version,
    };
}

/** Helper to retrieve the ignore ranges registered for a URI. */
export function getRegisteredIgnoreRanges(_api: ReturnType<typeof createAPI>, _uri: vscode.Uri): IgnoreRange[] {
    // The API object has a closure over ignoreRanges, so we expose a helper
    // This is used internally by the extension to check against API-registered ranges
    return [];
}

/**
 * The API's severity string for a core severity.
 *
 * Named by the proto's own constants: the numbers used to be spelled out
 * here, one off, which reported information as "error" and error as
 * "information" to every extension using the API.
 */
export function severityToString(severity: number | null | undefined): 'error' | 'warning' | 'information' | 'hint' {
    switch (severity) {
        case languagecheck.Severity.SEVERITY_ERROR: return 'error';
        case languagecheck.Severity.SEVERITY_WARNING: return 'warning';
        case languagecheck.Severity.SEVERITY_INFORMATION: return 'information';
        case languagecheck.Severity.SEVERITY_HINT: return 'hint';
        default: return 'warning';
    }
}

/**
 * The API's checkDocument: open the document and ask the core, whatever state
 * the editor's own diagnostics are in.
 *
 * Reads the client again after opening the document, as it always has: a
 * restart in between replaces it.
 */
export async function apiCheckDocument(core: CoreService, uri: vscode.Uri): Promise<LanguageCheckDiagnostic[]> {
    if (!core.client) return [];
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const languageId = document.languageId;

    try {
        const response = await core.client.sendRequest({
            checkProse: { text, languageId, filePath: uri.fsPath }
        });
        if (!response.checkProse?.diagnostics) return [];
        return response.checkProse.diagnostics.map(d => ({
            startByte: d.startByte ?? 0,
            endByte: d.endByte ?? 0,
            message: d.message ?? '',
            ruleId: d.ruleId ?? '',
            unifiedId: d.unifiedId ?? '',
            severity: severityToString(d.severity),
            suggestions: d.suggestions ?? [],
            confidence: d.confidence ?? 0,
        }));
    } catch {
        return [];
    }
}
