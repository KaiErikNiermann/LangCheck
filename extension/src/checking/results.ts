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
    /**
     * Documents checked whole since they opened (or since the config last
     * changed): their prose is in the core's result cache, so a progressive
     * check of them is not needed (windows.ts).
     */
    readonly checkedWhole = new Set<string>();

    /**
     * Forget one document, when it closes.
     *
     * Kept only for the Inspector and the insights status bar, which both
     * describe an open document; a closed one is checked again when it
     * reopens. Nothing removed an entry before, so a workspace check left a
     * copy of every file's prose -- twice over, with the checked text -- held
     * for the rest of the session.
     */
    forget(uri: string): void {
        this.extraction.delete(uri);
        this.names.delete(uri);
        this.checkedWhole.delete(uri);
    }

    /** Forget what the checks said about each document, before a re-check under a new config. */
    clearDocuments(): void {
        this.extraction.clear();
        this.names.clear();
        // A new config rebuilds the core's engines, and their result cache with them.
        this.checkedWhole.clear();
    }
}
