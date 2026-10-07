// The contract between the dispatcher and a concrete web editor. Adapters
// deal only in document offsets (UTF-16, i.e. JS string indices); all of the
// vscode-shaped line/character bookkeeping stays in the shim.

/** Mirrors `vscode.DiagnosticSeverity`: Error=0, Warning=1, Information=2, Hint=3. */
export type Severity = 0 | 1 | 2 | 3;

export interface RenderedDiagnostic {
    readonly from: number;
    readonly to: number;
    readonly severity: Severity;
    readonly message: string;
    readonly source: string | undefined;
    readonly code: string | undefined;
}

export interface RenderedAction {
    readonly title: string;
    run(): Promise<void>;
}

/** Ghost text drawn at `at`, the way VS Code draws an inlay hint. */
export interface RenderedHint {
    readonly at: number;
    readonly label: string;
}

/**
 * Replaces `[from, to)` with `insert`, if that span still holds `expected`:
 * the text the client saw there. An editor's text can change without the
 * client hearing of it in time (a site swapping in another file, a
 * collaborator's edit in flight), and an edit by stale offsets would land
 * on other text; checked here, it is refused instead.
 */
export interface TextEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
    readonly expected: string;
}

/** Asked by the adapter when the user interacts with the span `[from, to)`. */
export type ActionSource = (from: number, to: number) => Promise<readonly RenderedAction[]>;

/** Asked by the adapter when the pointer rests at `pos`; plain-text paragraphs. */
export type HoverSource = (pos: number) => Promise<readonly string[]>;

export interface EditorAdapter {
    readonly uri: string;
    readonly languageId: string;
    getText(): string;
    onDidChange(listener: () => void): void;
    renderDiagnostics(diagnostics: readonly RenderedDiagnostic[]): void;
    renderHints(hints: readonly RenderedHint[]): void;
    /** Applies all of `edits`, or none when any span no longer holds what it expects (then `false`). */
    applyEdits(edits: readonly TextEdit[]): boolean;
    setActionSource(source: ActionSource): void;
    setHoverSource(source: HoverSource): void;
    notify(message: string): void;
    /** Selects `[from, to)` and scrolls it into view (SpeedFix's go-to-location). */
    select(from: number, to: number): void;
}
