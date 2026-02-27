/** Shared type-safe events between extension host and webviews. */

// ── SpeedFix ──

export interface SpeedFixDiagnostic {
    id: string;
    message: string;
    suggestions: string[];
    context: string;
    ruleId: string;
    fileName: string;
    lineNumber: number;
}

// Messages from extension → SpeedFix webview
export type ExtensionToWebviewMessage =
    | { type: 'setDiagnostics'; payload: SpeedFixDiagnostic[] }
    | { type: 'setLowResource'; payload: boolean }
    | { type: 'loading'; payload: boolean }
    | { type: 'allDone' };

// Messages from SpeedFix webview → extension
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'applyFix'; payload: { diagnosticId: string; suggestion: string } }
    | { type: 'ignore'; payload: { diagnosticId: string } }
    | { type: 'addDictionary'; payload: { word: string } }
    | { type: 'goToLocation'; payload: { diagnosticId: string } }
    | { type: 'skip' }
    | { type: 'prev' }
    | { type: 'next' }
    | { type: 'refresh' }
    | { type: 'close' };

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

export interface InspectorDiagnosticSummary {
    total: number;
    byRule: { ruleId: string; count: number }[];
    bySeverity: { severity: string; count: number }[];
}

export interface InspectorCheckInfo {
    fileName: string;
    fileSize: number;
    languageId: string;
    proseRangeCount: number;
    totalProseBytes: number;
    diagnosticCount: number;
}

// Messages from extension → Inspector webview
export type ExtensionToInspectorMessage =
    | { type: 'setAST'; payload: { ast: InspectorASTNode; fileName: string } }
    | { type: 'setProseRanges'; payload: { prose: InspectorProseRange[]; ignores: InspectorIgnoreRange[] } }
    | { type: 'setLatency'; payload: { stages: InspectorLatencyStage[] } }
    | { type: 'setDiagnosticSummary'; payload: InspectorDiagnosticSummary }
    | { type: 'setCheckInfo'; payload: InspectorCheckInfo };

// Messages from Inspector webview → extension
export type InspectorToExtensionMessage =
    | { type: 'inspectorReady' }
    | { type: 'highlightRange'; payload: { startByte: number; endByte: number } };
