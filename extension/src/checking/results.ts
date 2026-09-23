/**
 * What the last checks reported beyond the diagnostics themselves.
 *
 * Written by the check and read by the Inspector and the insights status bar,
 * which is why it is kept apart from both.
 */
import type {
    InspectorCheckInfo,
    InspectorEngineHealth,
    InspectorNameSpan,
    InspectorProseRange,
} from '../ui/webviews/protocol';

/** The prose the core extracted from one document, as the Inspector draws it. */
export interface CachedExtraction {
    prose: InspectorProseRange[];
    languageId: string;
    syntax: string;
    maxRangeBytes: number;
    /**
     * The document version the check read. Under the onSave trigger an edit
     * is not checked until it is saved, and the ranges keep describing the
     * text as it was; the Inspector says so rather than draw them over text
     * they no longer match.
     */
    version: number;
}

export class CheckResults {
    /** Extraction data per document URI, from the core's response. */
    readonly extraction = new Map<string, CachedExtraction>();
    /** Words the name filter silenced on the last check, per document. */
    readonly names = new Map<string, InspectorNameSpan[]>();
    /** Stage timings of the last check (real benchmark data for the Inspector). */
    timings: { name: string; durationMs: number }[] = [];
    info: InspectorCheckInfo | null = null;
    engineHealth: InspectorEngineHealth[] = [];
    /**
     * Whether the last check was answered from the core's stored result.
     *
     * Kept here because `checkDocument` returns a count for its many callers
     * and only the command needs this. Read immediately after the check that
     * set it, so there is nothing to key it by.
     */
    servedFromCache = false;

    /** Forget what the checks said about each document, before a re-check under a new config. */
    clearDocuments(): void {
        this.extraction.clear();
        this.names.clear();
    }
}
