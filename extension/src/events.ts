/** Shared type-safe events between extension host and SpeedFix webview. */

export interface SpeedFixDiagnostic {
    id: string;
    message: string;
    suggestions: string[];
    context: string;
    ruleId: string;
}

// Messages from extension → webview
export type ExtensionToWebviewMessage =
    | { type: 'setDiagnostics'; payload: SpeedFixDiagnostic[] };

// Messages from webview → extension
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'applyFix'; payload: { diagnosticId: string; suggestion: string } }
    | { type: 'ignore'; payload: { diagnosticId: string } }
    | { type: 'addDictionary'; payload: { diagnosticId: string } };
