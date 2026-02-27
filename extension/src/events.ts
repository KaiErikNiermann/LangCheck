/** Shared type-safe events between extension host and webviews. */

// ── SpeedFix ──

export interface SpeedFixDiagnostic {
    id: string;
    message: string;
    suggestions: string[];
    context: string;
    ruleId: string;
}

// Messages from extension → SpeedFix webview
export type ExtensionToWebviewMessage =
    | { type: 'setDiagnostics'; payload: SpeedFixDiagnostic[] }
    | { type: 'setLowResource'; payload: boolean };

// Messages from SpeedFix webview → extension
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'applyFix'; payload: { diagnosticId: string; suggestion: string } }
    | { type: 'ignore'; payload: { diagnosticId: string } }
    | { type: 'addDictionary'; payload: { diagnosticId: string } };

// ── Inspector ──

export interface InspectorASTNode {
    kind: string;
    startByte: number;
    endByte: number;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    children: InspectorASTNode[];
}

export interface InspectorProseRange {
    startByte: number;
    endByte: number;
    text: string;
}

export interface InspectorIgnoreRange {
    startByte: number;
    endByte: number;
    ruleIds: string[];
    kind: string;
}

export interface InspectorLatencyStage {
    name: string;
    durationMs: number;
}

// Messages from extension → Inspector webview
export type ExtensionToInspectorMessage =
    | { type: 'setAST'; payload: { ast: InspectorASTNode; fileName: string } }
    | { type: 'setProseRanges'; payload: { prose: InspectorProseRange[]; ignores: InspectorIgnoreRange[] } }
    | { type: 'setLatency'; payload: { stages: InspectorLatencyStage[] } };

// Messages from Inspector webview → extension
export type InspectorToExtensionMessage =
    | { type: 'inspectorReady' }
    | { type: 'highlightRange'; payload: { startByte: number; endByte: number } };
