// A browser stand-in for the `vscode` module. esbuild aliases `vscode` to this
// file in the web bundle, so feature code written against the real API runs
// unchanged. Implemented members forward to the dispatcher (`host`); any
// namespace member we have not implemented resolves to a logged no-op instead
// of crashing, which is the "fallback for VS Code-only behaviour".
import type { ActionSource, EditorAdapter, HoverSource, RenderedAction, RenderedDiagnostic, RenderedHint, TextEdit } from '../editor/types';

// ---------------------------------------------------------------- primitives

export class Disposable {
    static from(...items: { dispose(): unknown }[]): Disposable {
        return new Disposable(() => { for (const i of items) i.dispose() });
    }
    constructor(private readonly onDispose: () => unknown) {}
    dispose(): void {
        this.onDispose();
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

export class Uri {
    private constructor(
        readonly scheme: string,
        readonly path: string,
    ) {}
    static parse(value: string): Uri {
        const i = value.indexOf(':');
        return i === -1 ? new Uri('file', value) : new Uri(value.slice(0, i), value.slice(i + 1));
    }
    static file(path: string): Uri {
        return new Uri('file', path);
    }
    get fsPath(): string {
        return this.path;
    }
    toString(): string {
        return `${this.scheme}:${this.path}`;
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

interface Command {
    command: string;
    title: string;
    arguments?: unknown[];
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
    constructor(
        readonly title: string,
        readonly kind?: CodeActionKind,
    ) {}
}

// ------------------------------------------------------------- the document

export class TextDocument {
    version = 1;
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
        this.length = text.length;
        this.lineStarts = [0];
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.lineStarts.push(i + 1);
    }
    getText(range?: Range): string {
        const text = this.adapter.getText();
        return range === undefined ? text : text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }
    /** VS Code's default word pattern, minus the number alternative. */
    private static readonly WORD_PATTERN = /[^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+/gu;

    getWordRangeAtPosition(position: Position, pattern?: RegExp): Range | undefined {
        const start = this.offsetAt(new Position(position.line, 0));
        const next = this.lineStarts[position.line + 1];
        const line = this.adapter.getText().slice(start, next === undefined ? this.length : next - 1);
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
    private collections = 0;

    /** Tells collections of the same name apart; only uniqueness matters. */
    nextCollectionId(): number {
        return ++this.collections;
    }

    open(adapter: EditorAdapter): TextDocument {
        const doc = new TextDocument(adapter);
        const key = doc.uri.toString();
        this.documents.set(key, doc);
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

    allDiagnostics(uri: string): Diagnostic[] {
        return [...(this.diagnostics.get(uri)?.values() ?? [])].flat();
    }

    private actionSourceFor(doc: TextDocument): ActionSource {
        return async (from, to) => {
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
            return batches.flatMap((b) => b ?? []).map((a): RenderedAction => ({
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
            delete: (uri: Uri) => { setFor(uri.toString(), []); },
            get: (uri: Uri) => host.diagnostics.get(uri.toString())?.get(owner),
            clear: () => { touched.forEach((uri) => { setFor(uri, []); }); },
            dispose: () => { touched.forEach((uri) => { setFor(uri, []); }); },
        };
    },
    registerCodeActionsProvider(selector: Selector | readonly Selector[], provider: CodeActionProvider) {
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

export const workspace = withFallback('workspace', {
    get textDocuments(): TextDocument[] {
        return [...host.documents.values()];
    },
    onDidOpenTextDocument: host.onDidOpen.event,
    onDidChangeTextDocument: host.onDidChange.event,
    onDidCloseTextDocument: host.onDidClose.event,
    /** All or nothing, like VS Code: an edit naming a document that is not open applies nowhere. */
    applyEdit(edit: WorkspaceEdit): Promise<boolean> {
        const byUri = [...Map.groupBy(edit.entries, (r) => r.uri.toString())].map(([uri, replacements]) => ({ doc: host.documents.get(uri), replacements }));
        if (byUri.some((e) => e.doc === undefined)) return Promise.resolve(false);
        for (const { doc, replacements } of byUri) {
            if (doc === undefined) continue;
            doc.adapter.applyEdits(
                replacements.map((r): TextEdit => ({ from: doc.offsetAt(r.range.start), to: doc.offsetAt(r.range.end), insert: r.newText })),
            );
        }
        return Promise.resolve(true);
    },
});

export const commands = withFallback('commands', {
    registerCommand(id: string, callback: (...args: never[]) => unknown) {
        host.commands.set(id, callback);
        return new Disposable(() => host.commands.delete(id));
    },
    executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
        const cb = host.commands.get(id);
        if (cb === undefined) return Promise.reject(new Error(`command '${id}' not found`));
        try {
            return Promise.resolve((cb as (...a: unknown[]) => unknown)(...args));
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    },
});

/** The page shows one message at a time; whichever document is open shows it. */
function notify(message: string): Promise<undefined> {
    for (const d of host.documents.values()) d.adapter.notify(message);
    return Promise.resolve(undefined);
}

export const window = withFallback('window', {
    showInformationMessage: notify,
    showWarningMessage: notify,
    showErrorMessage: notify,
});

/** The part of `vscode.ExtensionContext` a web feature gets: somewhere to put what it must dispose. */
export interface ExtensionContext {
    readonly subscriptions: { dispose(): unknown }[];
}

export const env = withFallback('env', {});
export const extensions = withFallback('extensions', {});
export const l10n = withFallback('l10n', {
    t: (message: string, ...args: unknown[]) => message.replaceAll(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])),
});
