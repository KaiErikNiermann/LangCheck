/** Shared type-safe events between extension host and webviews. */

// ── SpeedFix ──

export interface SpeedFixDiagnostic {
    id: string;
    message: string;
    suggestions: string[];
    text: string;       // The actual problematic word/phrase at the diagnostic range
    context: string;    // The full line of text for context display
    ruleId: string;
    fileName: string;
    lineNumber: number;
}

export type SpeedFixScope = 'file' | 'workspace';

// Messages from extension → SpeedFix webview
export type ExtensionToWebviewMessage =
    | { type: 'setDiagnostics'; payload: SpeedFixDiagnostic[] }
    | { type: 'setLowResource'; payload: boolean }
    | { type: 'loading'; payload: boolean }
    | { type: 'allDone' }
    | { type: 'setScope'; payload: SpeedFixScope }
    | { type: 'setWorkspaceProgress'; payload: { filesWithIssues: number } };

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
    | { type: 'close' }
    | { type: 'setScope'; payload: SpeedFixScope };

// ── Inspector ──

export interface InspectorExclusion {
    startChar: number;
    endChar: number;
    kind: string;
    text: string;
}

export interface InspectorProseRange {
    startByte: number;
    endByte: number;
    text: string;
    cleanText: string;
    exclusions: InspectorExclusion[];
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
    englishEngine: string;
}

export interface InspectorEvent {
    timestamp: number;      // Date.now()
    level: 'info' | 'warn' | 'error' | 'debug';
    source: string;         // e.g. 'checkDocument', 'addToDictionary', 'applyFix'
    message: string;
    durationMs?: number;    // optional elapsed time
    details?: string;       // optional extra context
}

export interface InspectorEngineHealth {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    consecutiveFailures: number;
    lastError: string;
    lastSuccessEpochMs: number;
}

// Messages from extension → Inspector webview
export type ExtensionToInspectorMessage =
    | { type: 'setExtraction'; payload: { prose: InspectorProseRange[]; fileName: string; languageId: string } }
    | { type: 'setLatency'; payload: { stages: InspectorLatencyStage[] } }
    | { type: 'setDiagnosticSummary'; payload: InspectorDiagnosticSummary }
    | { type: 'setCheckInfo'; payload: InspectorCheckInfo }
    | { type: 'pushEvent'; payload: InspectorEvent }
    | { type: 'clearEvents' }
    | { type: 'setEngineHealth'; payload: InspectorEngineHealth[] }
    | { type: 'setDockerAvailable'; payload: boolean };

// Messages from Inspector webview → extension
export type InspectorToExtensionMessage =
    | { type: 'inspectorReady' }
    | { type: 'highlightRange'; payload: { startByte: number; endByte: number } }
    | { type: 'healthCheckLT' }
    | { type: 'restartLTDocker' };
