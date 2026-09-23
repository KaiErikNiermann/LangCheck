import type { ByteOffset } from '../../checking/offsets';
import type { DiagId } from '../../diagnostics/diagnostic';

/** Shared type-safe events between extension host and webviews. */

// ── SpeedFix ──

export interface SpeedFixDiagnostic {
    id: DiagId;
    message: string;
    suggestions: string[];        // Raw replacement values (applied verbatim)
    suggestionLabels: string[];   // Human-readable label per suggestion (display only)
    text: string;       // The actual problematic word/phrase at the diagnostic range
    displayText: string;          // `text` with whitespace made visible (display only)
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
    | { type: 'applyFix'; payload: { diagnosticId: DiagId; suggestion: string } }
    | { type: 'ignore'; payload: { diagnosticId: DiagId } }
    | { type: 'addDictionary'; payload: { word: string } }
    | { type: 'goToLocation'; payload: { diagnosticId: DiagId } }
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

/** A word the name filter recognised as a human name and therefore silenced. */
export interface InspectorNameSpan {
    startByte: ByteOffset;
    endByte: ByteOffset;
    /** The word as it appears in the document. */
    text: string;
    /** Summed signal weight; higher means stronger evidence. */
    confidence: number;
    /** Which signals fired, e.g. ["gazetteer", "shape"]. */
    signals: string[];
    line: number;
}

export interface InspectorProseRange {
    startByte: ByteOffset;
    endByte: ByteOffset;
    text: string;
    cleanText: string;
    exclusions: InspectorExclusion[];
    /**
     * The BCP-47 tag this range was checked in, as the core resolved it — the
     * document's own `lang:` declaration where it makes one, the configured
     * `spell_language` otherwise. Empty when the last check predates the core
     * reporting it.
     */
    language: string;
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

export interface InspectorEngineInfo {
    name: string;
    enabled: boolean;
    /** 'builtin' engines (harper) are always available; 'external' need a binary */
    type: 'builtin' | 'external';
    /** Whether the external binary was found in PATH (always true for builtin) */
    binaryDetected: boolean;
    /** Path to detected engine-specific config, if any */
    configPath: string;
}

/** A file the config turned away, and the key that did it. */
export interface InspectorSkippedFile {
    path: string;
    rejectedBy: string;
}

/** Which config is in force and which files it selects, as `config files` prints it. */
export interface InspectorConfigScope {
    /** Absolute path of the config file in force; empty when the defaults apply. */
    configPath: string;
    include: string[];
    exclude: string[];
    fileTypes: string[];
    /** Workspace-relative, sorted. */
    selected: string[];
    skipped: InspectorSkippedFile[];
    /** Why the config file could not be read, in which case the lists are the defaults'. */
    loadError: string;
}

// Messages from extension → Inspector webview
export type ExtensionToInspectorMessage =
    | {
        type: 'setExtraction';
        payload: {
            prose: InspectorProseRange[];
            fileName: string;
            /** What the editor calls the file. */
            languageId: string;
            /** What the core actually parsed it as; may differ from languageId. */
            syntax: string;
            /**
             * The size prose ranges are split at, in bytes. A range over it is
             * one the splitter could not divide, which means one cache key
             * covering all of it — worth showing rather than leaving silent.
             * Zero when splitting is switched off.
             */
            maxRangeBytes: number;
            /** The document was edited after the check these ranges came from. */
            stale: boolean;
        };
    }
    | { type: 'setStale'; payload: boolean }
    /** Null when there is no core to ask. */
    | { type: 'setConfigScope'; payload: InspectorConfigScope | null }
    | { type: 'setNames'; payload: { names: InspectorNameSpan[] } }
    | { type: 'setLatency'; payload: { stages: InspectorLatencyStage[] } }
    | { type: 'setDiagnosticSummary'; payload: InspectorDiagnosticSummary }
    | { type: 'setCheckInfo'; payload: InspectorCheckInfo }
    | { type: 'pushEvent'; payload: InspectorEvent }
    | { type: 'clearEvents' }
    | { type: 'setEngineHealth'; payload: InspectorEngineHealth[] }
    | { type: 'setEngineInfo'; payload: InspectorEngineInfo[] }
    | { type: 'setDockerAvailable'; payload: boolean }
    | { type: 'setExtensionVersion'; payload: string };

// Messages from Inspector webview → extension
export type InspectorToExtensionMessage =
    | { type: 'inspectorReady' }
    | { type: 'highlightRange'; payload: { startByte: ByteOffset; endByte: ByteOffset } }
    | { type: 'healthCheckLT' }
    | { type: 'restartLTDocker' }
    | { type: 'openIssue'; payload: { body: string } }
    | { type: 'copyReport'; payload: { body: string } };
