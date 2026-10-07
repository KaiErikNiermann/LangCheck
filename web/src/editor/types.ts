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

/** A decoration type, as far as an editor draws it: a key, and the gutter icon (a URL) if it has one. */
export interface RenderedDecorationType {
    readonly key: string;
    readonly gutterIcon: string | undefined;
}

/** One mark of a decoration type: `[from, to)`, and the text its hover shows. */
export interface RenderedDecoration {
    readonly from: number;
    readonly to: number;
    readonly hover: string | undefined;
}

/** Ghost text drawn at `at`, the way VS Code draws an inlay hint. */
export interface RenderedHint {
    readonly at: number;
    readonly label: string;
}

/**
 * Replaces `[from, to)` with `insert`, if the text from `expectedAt` still
 * reads `expected`: the span and some context either side of it, as the
 * client saw them. An editor's text can change without the client hearing
 * of it in time (a site swapping in another file, a collaborator's edit in
 * flight), and an edit by stale offsets would land on other text; checked
 * (editsHold), it is refused instead. The context is what checks an
 * insertion, whose own span is empty, and what keeps a replacement from
 * passing on equal text that merely sits at the same offset.
 */
export interface TextEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
    readonly expected: string;
    /** Where `expected` starts: at or before `from`, and it runs to `to` or past. */
    readonly expectedAt: number;
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
    /**
     * Draws one decoration type's marks (VS Code's setDecorations), for an
     * editor that has a gutter to draw them in; the others leave it out.
     */
    renderDecorations?(type: RenderedDecorationType, marks: readonly RenderedDecoration[]): void;
    /** Applies all of `edits`, or none when any span no longer holds what it expects (then `false`). */
    applyEdits(edits: readonly TextEdit[]): boolean;
    setActionSource(source: ActionSource): void;
    setHoverSource(source: HoverSource): void;
    notify(message: string): void;
    /** Selects `[from, to)` and scrolls it into view (SpeedFix's go-to-location). */
    select(from: number, to: number): void;
    /** Where the user is: the cursor while it is in view, else the top of the view (a character offset). For a progressive check to start there. */
    focusOffset?(): number | undefined;
}
