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

export interface TextEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
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
    applyEdits(edits: readonly TextEdit[]): void;
    setActionSource(source: ActionSource): void;
    setHoverSource(source: HoverSource): void;
    notify(message: string): void;
}
