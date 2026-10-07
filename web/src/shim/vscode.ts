// A browser stand-in for the `vscode` module. esbuild aliases `vscode` to this
// file in the web bundle, so feature code written against the real API runs
// unchanged. Implemented members forward to the dispatcher (`host`); any
// namespace member we have not implemented resolves to a logged no-op instead
// of crashing, which is the "fallback for VS Code-only behaviour".
import { configs } from '../../../extension/src/generated/meta';
import type { ActionSource, EditorAdapter, HoverSource, RenderedAction, RenderedDiagnostic, RenderedHint, TextEdit } from '../editor/types';

// ---------------------------------------------------------------- primitives

/**
 * Structural, as VS Code's is: anything with a `dispose` method is one, so
 * `context.subscriptions` (plain `{ dispose() }` objects) passes where the
 * client's code asks for `Disposable[]`. The callback lives in a closure,
 * not a private field, which would make the type nominal.
 */
export class Disposable {
    static from(...items: { dispose(): unknown }[]): Disposable {
        return new Disposable(() => {
            for (const i of items) i.dispose();
        });
    }
    readonly dispose: () => void;
    constructor(onDispose: () => unknown) {
        this.dispose = () => {
            onDispose();
        };
    }
}

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
    private readonly listeners = new Set<Listener<T>>();
    readonly event = (listener: Listener<T>, thisArgs?: unknown, disposables?: Disposable[]): Disposable => {
        const bound: Listener<T> = (e) => listener.call(thisArgs, e);
        this.listeners.add(bound);
        const d = new Disposable(() => this.listeners.delete(bound));
        disposables?.push(d);
        return d;
    };
    fire(e: T): void {
        this.listeners.forEach((l) => l(e));
    }
    dispose(): void {
        this.listeners.clear();
    }
}

/** Decodes one percent-encoded path, leaving a malformed escape as it is (VS Code does the same). */
function decodePath(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

/**
 * As VS Code's: `path` is decoded (what a file name reads as), and
 * `toString()` encodes it again, one segment at a time, so a string from
 * `toString()` parses back to the same Uri.
 */
export class Uri {
    private constructor(
        readonly scheme: string,
        readonly path: string,
    ) {}
    static parse(value: string): Uri {
        const i = value.indexOf(':');
        return i === -1 ? new Uri('file', decodePath(value)) : new Uri(value.slice(0, i), decodePath(value.slice(i + 1)));
    }
    static file(path: string): Uri {
        return new Uri('file', path);
    }
    static joinPath(base: Uri, ...segments: string[]): Uri {
        let path = base.path;
        while (path.endsWith('/')) path = path.slice(0, -1);
        return new Uri(base.scheme, [path, ...segments].join('/'));
    }
    get fsPath(): string {
        return this.path;
    }
    toString(): string {
        // A lone surrogate cannot be encoded: it becomes U+FFFD, as UTF-8 would make it.
        return `${this.scheme}:${this.path.split('/').map((segment) => encodeURIComponent(segment.toWellFormed())).join('/')}`;
    }
}

export class Position {
    constructor(
        readonly line: number,
        readonly character: number,
    ) {}
    isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }
    isBefore(other: Position): boolean {
        return this.line < other.line || (this.line === other.line && this.character < other.character);
    }
}

export class Range {
    constructor(
        readonly start: Position,
        readonly end: Position,
    ) {}
    get isEmpty(): boolean {
        return this.start.isEqual(this.end);
    }
    isEqual(other: Range): boolean {
        return this.start.isEqual(other.start) && this.end.isEqual(other.end);
    }
    intersects(other: Range): boolean {
        return this.intersection(other) !== undefined;
    }
    /** Like VS Code: the overlap, empty when the ranges only touch, `undefined` when they are apart. */
    intersection(other: Range): Range | undefined {
        const start = this.start.isBefore(other.start) ? other.start : this.start;
        const end = this.end.isBefore(other.end) ? this.end : other.end;
        return end.isBefore(start) ? undefined : new Range(start, end);
    }
    contains(position: Position): boolean {
        return !position.isBefore(this.start) && !this.end.isBefore(position);
    }
}

/** A selection is a range with a direction: from `anchor` to `active`. */
export class Selection extends Range {
    constructor(
        readonly anchor: Position,
        readonly active: Position,
    ) {
        super(anchor.isBefore(active) ? anchor : active, anchor.isBefore(active) ? active : anchor);
    }
}

export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
    InCenterIfOutsideViewport = 2,
    AtTop = 3,
}

export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
}

export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

export class Diagnostic {
    source: string | undefined;
    code: string | number | undefined;
    constructor(
        public range: Range,
        public message: string,
        public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
    ) {}
}

export class CodeActionKind {
    static readonly QuickFix = new CodeActionKind('quickfix');
    constructor(readonly value: string) {}
}

export type Thenable<T> = PromiseLike<T>;

declare global {
    // VS Code's typings declare Thenable globally, and the client's code uses it unqualified.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Thenable<T> extends PromiseLike<T> {}
}

export interface Command {
    command: string;
    title: string;
    tooltip?: string;
    arguments?: unknown[];
}

export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
}

export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}

export class ThemeColor {
    constructor(readonly id: string) {}
}

interface Replacement {
    readonly uri: Uri;
    readonly range: Range;
    readonly newText: string;
}

export class WorkspaceEdit {
    private readonly replacements: Replacement[] = [];
    replace(uri: Uri, range: Range, newText: string): void {
        this.replacements.push({ uri, range, newText });
    }
    insert(uri: Uri, position: Position, newText: string): void {
        this.replace(uri, new Range(position, position), newText);
    }
    delete(uri: Uri, range: Range): void {
        this.replace(uri, range, '');
    }
    get entries(): readonly Replacement[] {
        return this.replacements;
    }
}

export class MarkdownString {
    constructor(public value = '') {}
    appendText(text: string): this {
        this.value += text;
        return this;
    }
    appendMarkdown(markdown: string): this {
        this.value += markdown;
        return this;
    }
}

type HoverContent = MarkdownString | string | { language: string; value: string };

export class Hover {
    readonly contents: HoverContent[];
    constructor(
        contents: HoverContent | HoverContent[],
        readonly range?: Range,
    ) {
        this.contents = Array.isArray(contents) ? contents : [contents];
    }
}

export enum InlayHintKind {
    Type = 1,
    Parameter = 2,
}

export class InlayHint {
    paddingLeft: boolean | undefined;
    paddingRight: boolean | undefined;
    tooltip: string | MarkdownString | undefined;
    constructor(
        readonly position: Position,
        readonly label: string | readonly { value: string }[],
        readonly kind?: InlayHintKind,
    ) {}
}

export class CodeAction {
    edit: WorkspaceEdit | undefined;
    command: Command | undefined;
    diagnostics: Diagnostic[] | undefined;
    isPreferred: boolean | undefined;
    constructor(
        readonly title: string,
        readonly kind?: CodeActionKind,
    ) {}
}

// ------------------------------------------------------------- the document

export class TextDocument {
    version = 1;
    /**
     * The text as of the last change the adapter reported, which `version`,
     * the line table and every position here describe. Not the live text: an
     * editor can change without saying so in time (a site swapping in
     * another file), and positions from one text applied to another land on
     * the wrong characters. Edits name what they expect to replace, checked
     * against the live text (TextEdit.expected).
     */
    private text = '';
    private lineStarts: number[] = [0];
    private length = 0;
    readonly uri: Uri;
    constructor(readonly adapter: EditorAdapter) {
        this.uri = Uri.parse(adapter.uri);
        this.refresh();
    }
    get languageId(): string {
        return this.adapter.languageId;
    }
    get fileName(): string {
        return this.uri.path;
    }
    get lineCount(): number {
        return this.lineStarts.length;
    }
    refresh(): void {
        const text = this.adapter.getText();
        this.text = text;
        this.length = text.length;
        this.lineStarts = [0];
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.lineStarts.push(i + 1);
    }
    getText(range?: Range): string {
        return range === undefined ? this.text : this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }
    /** VS Code's default word pattern, minus the number alternative. */
    private static readonly WORD_PATTERN = /[^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+/gu;

    /** The line holding `line` (a number or a position), without its line break, as VS Code's TextLine. */
    lineAt(line: number | Position): TextLine {
        const index = Math.max(0, Math.min(typeof line === 'number' ? line : line.line, this.lineStarts.length - 1));
        const start = this.lineStarts[index] ?? 0;
        const next = this.lineStarts[index + 1];
        const end = next === undefined ? this.length : next - 1;
        const text = this.text.slice(start, end);
        const range = new Range(new Position(index, 0), new Position(index, end - start));
        return { lineNumber: index, text, range, isEmptyOrWhitespace: text.trim() === '', firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length };
    }

    getWordRangeAtPosition(position: Position, pattern?: RegExp): Range | undefined {
        const start = this.offsetAt(new Position(position.line, 0));
        const next = this.lineStarts[position.line + 1];
        const line = this.text.slice(start, next === undefined ? this.length : next - 1);
        const flags = (pattern ?? TextDocument.WORD_PATTERN).flags;
        // The pattern is the caller's (extension code), never page input.
        // eslint-disable-next-line security/detect-non-literal-regexp
        const regex = new RegExp((pattern ?? TextDocument.WORD_PATTERN).source, flags.includes('g') ? flags : `${flags}g`);
        for (const match of line.matchAll(regex)) {
            if (match[0].length === 0) continue;
            if (match.index <= position.character && position.character <= match.index + match[0].length) {
                return new Range(new Position(position.line, match.index), new Position(position.line, match.index + match[0].length));
            }
        }
        return undefined;
    }

    /** Like VS Code: lines past the end clamp to the end, characters to the line's length. */
    offsetAt(position: Position): number {
        if (position.line < 0) return 0;
        if (position.line >= this.lineStarts.length) return this.length;
        const start = this.lineStarts[position.line] ?? 0;
        const next = this.lineStarts[position.line + 1];
        const lineEnd = next === undefined ? this.length : next - 1;
        return Math.min(start + Math.max(0, position.character), lineEnd);
    }
    /** Binary search for the last line start <= offset; offsets clamp to the document. */
    positionAt(offset: number): Position {
        const clamped = Math.max(0, Math.min(Number.isFinite(offset) ? Math.trunc(offset) : 0, this.length));
        let lo = 0;
        let hi = this.lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if ((this.lineStarts[mid] ?? Infinity) <= clamped) lo = mid;
            else hi = mid - 1;
        }
        return new Position(lo, clamped - (this.lineStarts[lo] ?? 0));
    }
}

/**
 * The editor showing a document: one per page. Setting `selection` selects
 * the text in the site's editor; `revealRange` scrolls to it.
 */
export class TextEditor {
    private current: Selection;
    readonly viewColumn = ViewColumn.One;

    constructor(readonly document: TextDocument) {
        const start = new Position(0, 0);
        this.current = new Selection(start, start);
    }

    get selection(): Selection {
        return this.current;
    }

    set selection(selection: Selection) {
        this.current = selection;
        this.document.adapter.select(this.document.offsetAt(selection.start), this.document.offsetAt(selection.end));
    }

    revealRange(range: Range, _type?: TextEditorRevealType): void {
        this.document.adapter.select(this.document.offsetAt(range.start), this.document.offsetAt(range.end));
    }
}

export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
    readonly isEmptyOrWhitespace: boolean;
    readonly firstNonWhitespaceCharacterIndex: number;
}

// ------------------------------------------------------------ the dispatcher

interface CodeActionProvider {
    provideCodeActions(
        document: TextDocument,
        range: Range,
        context: { diagnostics: readonly Diagnostic[]; only: undefined; triggerKind: number },
    ): CodeAction[] | undefined | null | Promise<CodeAction[] | undefined | null>;
}

interface Selector {
    readonly language?: string;
}

interface HoverProvider {
    provideHover(document: TextDocument, position: Position, token: CancellationToken): Hover | undefined | null | Promise<Hover | undefined | null>;
}

interface InlayHintsProvider {
    readonly onDidChangeInlayHints?: (listener: () => unknown) => Disposable;
    provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): InlayHint[] | undefined | null | Promise<InlayHint[] | undefined | null>;
}

interface CancellationToken {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: (listener: () => unknown) => Disposable;
}

const NEVER_CANCELLED: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => new Disposable(() => {}),
};

interface Registration<P> {
    readonly selector: readonly Selector[];
    readonly provider: P;
}

const matches = (registration: Registration<unknown>, doc: TextDocument): boolean =>
    registration.selector.some((s) => s.language === undefined || s.language === doc.languageId);

const hoverText = (content: HoverContent): string => (typeof content === 'string' ? content : content.value);
const labelText = (label: InlayHint['label']): string => (typeof label === 'string' ? label : label.map((p) => p.value).join(''));

class Host {
    readonly documents = new Map<string, TextDocument>();
    readonly editors = new Map<TextDocument, TextEditor>();
    /** The document version each document's findings were last published at. */
    private readonly publishedAt = new WeakMap<TextDocument, number>();
    readonly diagnostics = new Map<string, Map<string, readonly Diagnostic[]>>(); // uri -> owner -> list
    readonly providers: Registration<CodeActionProvider>[] = [];
    readonly hoverProviders: Registration<HoverProvider>[] = [];
    readonly hintProviders: Registration<InlayHintsProvider>[] = [];
    readonly onDidChangeDiagnostics = new EventEmitter<{ readonly uris: readonly Uri[] }>();
    readonly commands = new Map<string, (...args: never[]) => unknown>();
    readonly onDidOpen = new EventEmitter<TextDocument>();
    readonly onDidClose = new EventEmitter<TextDocument>();
    readonly onDidChange = new EventEmitter<{ document: TextDocument; contentChanges: readonly never[] }>();
    readonly unsupported = new Set<string>();
    /** Opens a panel's page; installed by the composition root. */
    webviews: WebviewOpener | undefined;
    /**
     * Whether a document's findings describe its current text, which only
     * the client knows: it records the version each check was of. Installed
     * by the composition root; without it, findings are taken to describe
     * the text they were published at.
     */
    findingsCurrent: ((doc: TextDocument) => boolean) | undefined;
    /** Brings the page's own tab to the front (a panel tab may be in front of it). */
    focusPage: (() => void) | undefined;
    /** Settings changed through `update`, over the manifest defaults. */
    readonly settings = new Map<string, unknown>();
    private collections = 0;

    /** Tells collections of the same name apart; only uniqueness matters. */
    nextCollectionId(): number {
        return ++this.collections;
    }

    open(adapter: EditorAdapter): TextDocument {
        const doc = new TextDocument(adapter);
        const key = doc.uri.toString();
        this.documents.set(key, doc);
        this.editors.set(doc, new TextEditor(doc));
        adapter.setActionSource(this.actionSourceFor(doc));
        adapter.setHoverSource(this.hoverSourceFor(doc));
        adapter.onDidChange(() => {
            doc.version++;
            doc.refresh();
            this.onDidChange.fire({ document: doc, contentChanges: [] });
            void this.refreshHints(doc);
        });
        this.onDidOpen.fire(doc);
        void this.refreshHints(doc);
        return doc;
    }

    /** The editor stopped showing this document (Overleaf file switch). */
    close(doc: TextDocument): void {
        const key = doc.uri.toString();
        if (this.documents.get(key) !== doc) return;
        this.documents.delete(key);
        this.editors.delete(doc);
        this.diagnostics.delete(key);
        this.onDidClose.fire(doc);
    }

    /** Pulls inlay hints for the whole document; a newer request supersedes an older one. */
    async refreshHints(doc: TextDocument): Promise<void> {
        const version = doc.version;
        const providers = this.hintProviders.filter((r) => matches(r, doc));
        const whole = new Range(new Position(0, 0), doc.positionAt(Number.MAX_SAFE_INTEGER));
        const batches = await Promise.all(
            providers.map(async (r) => {
                try {
                    return (await r.provider.provideInlayHints(doc, whole, NEVER_CANCELLED)) ?? [];
                } catch (error) {
                    console.error('[vscode-shim] inlay hint provider failed', error);
                    return [];
                }
            }),
        );
        if (doc.version !== version || this.documents.get(doc.uri.toString()) !== doc) return;
        const hints: RenderedHint[] = batches.flat().map((h) => ({
            at: doc.offsetAt(h.position),
            label: `${h.paddingLeft === true ? ' ' : ''}${labelText(h.label)}${h.paddingRight === true ? ' ' : ''}`,
        }));
        doc.adapter.renderHints(hints);
    }

    private hoverSourceFor(doc: TextDocument): HoverSource {
        return async (pos) => {
            const position = doc.positionAt(pos);
            const hovers = await Promise.all(
                this.hoverProviders.filter((r) => matches(r, doc)).map((r) => Promise.resolve(r.provider.provideHover(doc, position, NEVER_CANCELLED))),
            );
            return hovers.flatMap((h) => h?.contents.map((c) => hoverText(c)) ?? []).filter((t) => t.length > 0);
        };
    }

    publish(uri: string): void {
        const doc = this.documents.get(uri);
        if (doc === undefined) return;
        // A list checked against older text has ranges in that text: drawn
        // now they would mark the wrong characters, and a fix from them
        // would edit there. The marks already drawn stay (the editor carries
        // them through the edit) until the check of the current text lands.
        if (!this.describesText(doc, doc.version)) return;
        this.publishedAt.set(doc, doc.version);
        const rendered: RenderedDiagnostic[] = [...(this.diagnostics.get(uri)?.values() ?? [])].flat().map((d) => ({
            from: doc.offsetAt(d.range.start),
            to: doc.offsetAt(d.range.end),
            severity: d.severity,
            message: d.message,
            source: d.source,
            code: d.code === undefined ? undefined : String(d.code),
        }));
        doc.adapter.renderDiagnostics(rendered);
    }

    /** Whether `doc`'s findings describe its current text (`publishedAt`: the version they were drawn at). */
    private describesText(doc: TextDocument, publishedAt: number | undefined): boolean {
        return this.findingsCurrent?.(doc) ?? publishedAt === doc.version;
    }

    allDiagnostics(uri: string): Diagnostic[] {
        return [...(this.diagnostics.get(uri)?.values() ?? [])].flat();
    }

    private actionSourceFor(doc: TextDocument): ActionSource {
        return async (from, to) => {
            // Findings describe the text they were published for. After an
            // edit their ranges are stale until the recheck lands, and a fix
            // would land on the wrong text: offer nothing until then. (VS Code
            // gets the same effect by shifting its markers, which then no
            // longer match the extension's store.)
            if (!this.describesText(doc, this.publishedAt.get(doc))) return [];
            const range = new Range(doc.positionAt(from), doc.positionAt(to));
            const diagnostics = [...(this.diagnostics.get(doc.uri.toString())?.values() ?? [])]
                .flat()
                .filter((d) => d.range.intersects(range));
            const matching = this.providers.filter((p) => matches(p, doc));
            const batches = await Promise.all(
                matching.map((p) =>
                    Promise.resolve(p.provider.provideCodeActions(doc, range, { diagnostics, only: undefined, triggerKind: 1 })),
                ),
            );
            // The preferred action (the top suggestion) leads, as in VS Code's
            // quick-fix menu and auto-fix; the rest keep the provider's order.
            const offered = batches.flatMap((b) => b ?? []);
            const ordered = [...offered.filter((a) => a.isPreferred === true), ...offered.filter((a) => a.isPreferred !== true)];
            return ordered.map((a): RenderedAction => ({
                title: a.title,
                run: async () => {
                    if (a.edit !== undefined) await workspace.applyEdit(a.edit);
                    if (a.command !== undefined) await commands.executeCommand(a.command.command, ...(a.command.arguments ?? []));
                },
            }));
        };
    }

    fallback(name: string): (...args: unknown[]) => Disposable {
        return () => {
            if (!this.unsupported.has(name)) console.warn(`[vscode-shim] unsupported: ${name}`);
            this.unsupported.add(name);
            return new Disposable(() => {});
        };
    }
}

export const host = new Host();

function withFallback<T extends object>(namespace: string, impl: T): T {
    return new Proxy(impl, {
        get: (target, prop, receiver) =>
            typeof prop === 'symbol' || Reflect.has(target, prop)
                ? Reflect.get(target, prop, receiver)
                : host.fallback(`${namespace}.${prop}`),
    });
}

// -------------------------------------------------------------- namespaces

function register<P>(list: Registration<P>[], selector: Selector | readonly Selector[], provider: P): Disposable {
    const entry: Registration<P> = { selector: Array.isArray(selector) ? selector : [selector as Selector], provider };
    list.push(entry);
    return new Disposable(() => {
        const i = list.indexOf(entry);
        if (i !== -1) list.splice(i, 1);
    });
}

export const languages = withFallback('languages', {
    createDiagnosticCollection(name = 'default') {
        const owner = `${name}#${String(host.nextCollectionId())}`;
        const touched = new Set<string>();
        const setFor = (uri: string, list: readonly Diagnostic[]): void => {
            const byOwner = host.diagnostics.get(uri) ?? new Map<string, readonly Diagnostic[]>();
            byOwner.set(owner, list);
            host.diagnostics.set(uri, byOwner);
            touched.add(uri);
            host.publish(uri);
            host.onDidChangeDiagnostics.fire({ uris: [Uri.parse(uri)] });
        };
        return {
            name,
            set: (uri: Uri, list: readonly Diagnostic[] | undefined) => { setFor(uri.toString(), list ?? []); },
            // Gone, not emptied: a document closed for good leaves nothing behind.
            delete: (uri: Uri) => {
                const key = uri.toString();
                const byOwner = host.diagnostics.get(key);
                byOwner?.delete(owner);
                if (byOwner?.size === 0) host.diagnostics.delete(key);
                touched.delete(key);
                host.publish(key);
                host.onDidChangeDiagnostics.fire({ uris: [uri] });
            },
            get: (uri: Uri) => host.diagnostics.get(uri.toString())?.get(owner),
            clear: () => { touched.forEach((uri) => { setFor(uri, []); }); },
            dispose: () => { touched.forEach((uri) => { setFor(uri, []); }); },
        };
    },
    registerCodeActionsProvider(selector: Selector | readonly Selector[], provider: CodeActionProvider, _metadata?: unknown) {
        return register(host.providers, selector, provider);
    },
    registerHoverProvider(selector: Selector | readonly Selector[], provider: HoverProvider) {
        return register(host.hoverProviders, selector, provider);
    },
    registerInlayHintsProvider(selector: Selector | readonly Selector[], provider: InlayHintsProvider) {
        const registration = register(host.hintProviders, selector, provider);
        const changes = provider.onDidChangeInlayHints?.(() => { host.documents.forEach((d) => void host.refreshHints(d)); });
        host.documents.forEach((d) => void host.refreshHints(d));
        return new Disposable(() => {
            changes?.dispose();
            registration.dispose();
        });
    },
    onDidChangeDiagnostics: host.onDidChangeDiagnostics.event,
    getDiagnostics(uri: Uri): Diagnostic[] {
        return host.allDiagnostics(uri.toString());
    },
});

export interface WorkspaceConfiguration {
    get<T>(key: string): T | undefined;
    get<T>(key: string, fallback: T): T;
    has(key: string): boolean;
    update(key: string, value: unknown, target?: ConfigurationTarget | boolean): Promise<void>;
}

/** Settings defaults, from the client's generated manifest table; the web has no settings editor yet. */
const SETTING_DEFAULTS: ReadonlyMap<string, unknown> = new Map(Object.values(configs).map((c) => [c.key, c.default]));

const NO_FILE_SYSTEM = (): Promise<never> => Promise.reject(new Error('a web page has no file system'));

/** An event nothing on the web raises (file watchers: there are no files). */
const neverFires = (_listener: (uri: Uri) => unknown): Disposable => new Disposable(() => {});

export const workspace = withFallback('workspace', {
    get textDocuments(): TextDocument[] {
        return [...host.documents.values()];
    },
    /** A web page is not a workspace folder. */
    workspaceFolders: undefined as readonly WorkspaceFolder[] | undefined,
    getConfiguration(section?: string): WorkspaceConfiguration {
        const full = (key: string): string => (section === undefined ? key : `${section}.${key}`);
        function get<T>(key: string): T | undefined;
        function get<T>(key: string, fallback: T): T;
        function get(key: string, fallback?: unknown): unknown {
            return host.settings.get(full(key)) ?? fallback ?? SETTING_DEFAULTS.get(full(key));
        }
        return {
            get,
            has: (key: string) => host.settings.has(full(key)) || SETTING_DEFAULTS.has(full(key)),
            update(key: string, value: unknown, _target?: ConfigurationTarget | boolean): Promise<void> {
                host.settings.set(full(key), value);
                return Promise.resolve();
            },
        };
    },
    findFiles: (_include?: string, _exclude?: string): Promise<Uri[]> => Promise.resolve([]),
    fs: {
        stat: (_uri: Uri): Promise<never> => NO_FILE_SYSTEM(),
        readFile: (_uri: Uri): Promise<Uint8Array> => NO_FILE_SYSTEM(),
        writeFile: (_uri: Uri, _content: Uint8Array): Promise<void> => NO_FILE_SYSTEM(),
    },
    createFileSystemWatcher(_glob?: string, _ignoreCreate?: boolean, _ignoreChange?: boolean, _ignoreDelete?: boolean) {
        return { onDidChange: neverFires, onDidCreate: neverFires, onDidDelete: neverFires, dispose: () => {} };
    },
    onDidOpenTextDocument: host.onDidOpen.event,
    onDidChangeTextDocument: host.onDidChange.event,
    onDidCloseTextDocument: host.onDidClose.event,
    /** Only documents already open in the page exist: a web page opens no files. */
    openTextDocument(uri: Uri): Promise<TextDocument> {
        const doc = host.documents.get(uri.toString());
        return doc === undefined ? Promise.reject(new Error(`${uri.toString()} is not open in this page`)) : Promise.resolve(doc);
    },
    /**
     * All or nothing, like VS Code: an edit naming a document that is not
     * open applies nowhere. Each replacement carries the text the document
     * holds there, and the editor refuses the lot when its text no longer
     * does: `false`, as VS Code answers an edit it could not apply.
     */
    applyEdit(edit: WorkspaceEdit): Promise<boolean> {
        const byUri = [...Map.groupBy(edit.entries, (r) => r.uri.toString())].map(([uri, replacements]) => ({ doc: host.documents.get(uri), replacements }));
        if (byUri.some((e) => e.doc === undefined)) return Promise.resolve(false);
        let applied = true;
        for (const { doc, replacements } of byUri) {
            if (doc === undefined) continue;
            applied &&= doc.adapter.applyEdits(
                replacements.map((r): TextEdit => ({ from: doc.offsetAt(r.range.start), to: doc.offsetAt(r.range.end), insert: r.newText, expected: doc.getText(r.range) })),
            );
        }
        return Promise.resolve(applied);
    },
});

export const commands = withFallback('commands', {
    registerCommand(id: string, callback: (...args: never[]) => unknown) {
        host.commands.set(id, callback);
        return new Disposable(() => host.commands.delete(id));
    },
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
        const cb = host.commands.get(id);
        if (cb === undefined) return Promise.reject(new Error(`command '${id}' not found`));
        try {
            return Promise.resolve((cb as (...a: unknown[]) => T)(...args));
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    },
});

/**
 * The page shows one message at a time; whichever document is open shows it.
 * Buttons (`items`) are not offered on the web: the answer is always
 * "dismissed", which is what VS Code returns when the user closes the toast.
 */
function notify(message: string, ..._items: unknown[]): Promise<undefined> {
    for (const d of host.documents.values()) d.adapter.notify(message);
    return Promise.resolve(undefined);
}

export interface OutputChannel {
    readonly name: string;
    append(value: string): void;
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
    clear(): void;
    dispose(): void;
}

export interface StatusBarItem {
    text: string;
    tooltip: string | MarkdownString | undefined;
    command: string | Command | undefined;
    backgroundColor: ThemeColor | undefined;
    show(): void;
    hide(): void;
    dispose(): void;
}

type Event<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

export interface WebviewOptions {
    readonly enableScripts?: boolean;
    readonly localResourceRoots?: readonly Uri[];
    readonly retainContextWhenHidden?: boolean;
}

export interface Webview {
    /** Ignored on the web: the panel's page is the extension's own (see WebviewChannel). */
    html: string;
    options: WebviewOptions;
    readonly cspSource: string;
    postMessage(message: unknown): Promise<boolean>;
    // VS Code types webview messages as `any`, and the client's handlers
    // declare their own message type: `unknown` would not accept them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly onDidReceiveMessage: Event<any>;
    asWebviewUri(uri: Uri): Uri;
}

export interface WebviewPanel {
    readonly webview: Webview;
    readonly viewType: string;
    title: string;
    readonly visible: boolean;
    reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
    readonly onDidDispose: Event<void>;
    dispose(): void;
}

/**
 * Where a webview panel really lives on the web: a page of the extension in
 * its own tab, showing the same webview app VS Code shows, with messages
 * carried both ways. Installed by the composition root (webviewHost.ts).
 */
export interface WebviewChannel {
    post(message: unknown): void;
    onMessage(listener: (message: unknown) => void): void;
    /** The tab was closed. */
    onClose(listener: () => void): void;
    reveal(): void;
    close(): void;
}

export type WebviewOpener = (viewType: string, title: string) => WebviewChannel;

function webviewPanel(viewType: string, title: string, channel: WebviewChannel): WebviewPanel {
    const received = new EventEmitter<unknown>();
    const disposed = new EventEmitter<void>();
    let open = true;
    const end = (): void => {
        if (!open) return;
        open = false;
        disposed.fire();
        received.dispose();
        disposed.dispose();
    };
    channel.onMessage((message) => {
        if (open) received.fire(message);
    });
    channel.onClose(end);
    return {
        viewType,
        title,
        get visible() {
            return open;
        },
        webview: {
            html: '',
            options: {},
            cspSource: '',
            postMessage(message) {
                if (open) channel.post(message);
                return Promise.resolve(open);
            },
            onDidReceiveMessage: received.event,
            asWebviewUri: (uri) => uri,
        },
        reveal() {
            if (open) channel.reveal();
        },
        onDidDispose: disposed.event,
        dispose() {
            if (open) channel.close();
            end();
        },
    };
}

interface Progress {
    report(value: { message?: string; increment?: number }): void;
}

export const window = withFallback('window', {
    showInformationMessage: notify,
    showWarningMessage: notify,
    showErrorMessage: notify,
    /** The page shows one document at a time: its editor is the active one. */
    get activeTextEditor(): TextEditor | undefined {
        return [...host.editors.values()].at(-1);
    },
    get visibleTextEditors(): TextEditor[] {
        return [...host.editors.values()];
    },
    /**
     * Shows the page's editor (both of VS Code's overloads): selects
     * `options.selection`, and brings the page's tab forward unless focus is
     * to be preserved. The column is meaningless with one editor.
     */
    showTextDocument(
        doc: TextDocument,
        columnOrOptions?: ViewColumn | { readonly selection?: Range; readonly preserveFocus?: boolean },
        preserveFocus?: boolean,
    ): Promise<TextEditor> {
        const editor = host.editors.get(doc);
        if (editor === undefined) return Promise.reject(new Error('the document is not open in this page'));
        const { selection, preserveFocus: keepFocus = preserveFocus } = typeof columnOrOptions === 'object' ? columnOrOptions : {};
        if (selection !== undefined) editor.selection = new Selection(selection.start, selection.end);
        if (keepFocus !== true) host.focusPage?.();
        return Promise.resolve(editor);
    },
    createWebviewPanel(viewType: string, title: string, _showOptions?: unknown, _options?: WebviewOptions): WebviewPanel {
        if (host.webviews === undefined) throw new Error('webview panels are not available in this page');
        return webviewPanel(viewType, title, host.webviews(viewType, title));
    },
    /** A page has no status bar: the item exists, shows nowhere. */
    createStatusBarItem(_alignment?: StatusBarAlignment, _priority?: number): StatusBarItem {
        return { text: '', tooltip: undefined, command: undefined, backgroundColor: undefined, show: () => {}, hide: () => {}, dispose: () => {} };
    },
    /** An output channel is the browser console. */
    createOutputChannel(name: string): OutputChannel {
        return {
            name,
            append: (value) => {
                console.info(`[${name}]`, value);
            },
            appendLine: (value) => {
                console.info(`[${name}]`, value);
            },
            show: () => {},
            clear: () => {},
            dispose: () => {},
        };
    },
    /** Runs the task; progress is not shown, and nothing cancels it. */
    withProgress<R>(_options: unknown, task: (progress: Progress, token: CancellationToken) => Thenable<R>): Promise<R> {
        return Promise.resolve(task({ report: () => {} }, NEVER_CANCELLED));
    },
});

/**
 * The part of `vscode.ExtensionContext` the client's code uses: somewhere to
 * put what it must dispose, and the extension's identity. There is no
 * extension directory on disk; webview assets come from the extension's own
 * pages instead (see the webview host).
 */
export interface ExtensionContext {
    readonly subscriptions: { dispose(): unknown }[];
    readonly extensionPath: string;
    readonly extensionUri: Uri;
    readonly extension: { readonly id: string; readonly packageJSON: { readonly version: string } };
}

export const env = withFallback('env', {
    openExternal(uri: Uri): Promise<boolean> {
        return Promise.resolve(globalThis.open(uri.toString(), '_blank', 'noopener,noreferrer') !== null);
    },
    clipboard: {
        writeText: (text: string): Promise<void> => navigator.clipboard.writeText(text),
        readText: (): Promise<string> => navigator.clipboard.readText(),
    },
});
export const extensions = withFallback('extensions', {});
export const l10n = withFallback('l10n', {
    t: (message: string, ...args: unknown[]) => message.replaceAll(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])),
});
