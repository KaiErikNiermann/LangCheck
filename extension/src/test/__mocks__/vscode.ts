/** Stand-in for the `vscode` module under vitest.
 *
 *  The unit suite runs outside an extension host, so `import * as vscode` in
 *  production code resolves to nothing and takes the whole suite down at import
 *  time. The pure modules need only `window.show*Message` and `l10n.t`.
 *
 *  `activationOrder.test.ts` needs more: it runs the whole of `activate()`
 *  and records, in order, every namespace call it makes and every event it
 *  subscribes to. So every namespace here is a recording auto-stub. A member
 *  given explicitly behaves as written, and any other member is a function
 *  that logs `namespace.member(args)` to {@link __calls} and returns an object
 *  that accepts any property write and logs its own `on*` subscriptions. That
 *  way the snapshot shows the order listeners were registered in, which VS
 *  Code dispatches by, and which no single e2e test can see. */

/** Every recorded call, in the order it happened. */
export const __calls: string[] = [];

export function __resetCalls(): void {
    __calls.length = 0;
}

/**
 * Every event subscription made on a namespace (`workspace.onDid…`,
 * `window.onDid…`, `languages.onDid…`), and whether its disposable has been
 * disposed. VS Code disposes what an extension pushes to its subscriptions;
 * a subscription left out of them outlives the extension.
 */
export const __listeners: { label: string; disposed: boolean }[] = [];

/** What the workspace looks like to the code under test. Tests set this before activating. */
export const __workspace: { folders: { uri: Uri; name: string; index: number }[] | undefined } = {
    folders: undefined,
};

function describeArg(arg: unknown): string {
    if (typeof arg === 'string') return JSON.stringify(arg);
    if (arg instanceof RelativePattern) return `RelativePattern(${JSON.stringify(arg.pattern)})`;
    if (Array.isArray(arg) && arg.every(a => typeof a === 'object' && a !== null && 'language' in a)) {
        return `[${arg.map(a => (a as { language: string }).language).join(',')}]`;
    }
    if (arg instanceof Uri) return `Uri(${arg.path})`;
    return typeof arg;
}

function record(name: string, args: readonly unknown[]): void {
    __calls.push(`${name}(${args.slice(0, 2).map(describeArg).join(', ')})`);
}

/** An object that takes any property write and records its `on*` subscriptions. */
function stub(label: string): Record<string, unknown> {
    const own: Record<string | symbol, unknown> = {};
    return new Proxy(own, {
        get(target, prop) {
            if (prop in target) return target[prop];
            // Not a thenable: an awaited stub must not look like a promise.
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            return (..._args: unknown[]) => {
                if (prop.startsWith('on')) record(`${label}.${prop}`, []);
                return stub(`${label}.${prop}()`);
            };
        },
        set(target, prop, value) {
            target[prop] = value;
            return true;
        },
    }) as Record<string, unknown>;
}

function namespace<T extends object>(name: string, known: T): T {
    return new Proxy(known, {
        get(target, prop, receiver) {
            if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
            return (...args: unknown[]) => {
                record(`${name}.${prop}`, args);
                if (prop.startsWith('on')) {
                    const listener = { label: `${name}.${prop}`, disposed: false };
                    __listeners.push(listener);
                    return { dispose: () => { listener.disposed = true; } };
                }
                return stub(`${name}.${prop}`);
            };
        },
    });
}

// ---------------------------------------------------------------- classes

export class Disposable {
    static from(...items: { dispose(): unknown }[]): Disposable {
        return new Disposable(() => items.forEach(i => i.dispose()));
    }
    constructor(private readonly onDispose?: () => unknown) {}
    dispose(): void {
        this.onDispose?.();
    }
}

export class EventEmitter<T> {
    private readonly listeners = new Set<(e: T) => unknown>();
    readonly event = (listener: (e: T) => unknown): Disposable => {
        this.listeners.add(listener);
        return new Disposable(() => this.listeners.delete(listener));
    };
    fire(e: T): void {
        this.listeners.forEach(l => l(e));
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
    static file(path: string): Uri {
        return new Uri('file', path);
    }
    static parse(value: string): Uri {
        const i = value.indexOf(':');
        return i < 0 ? new Uri('file', value) : new Uri(value.slice(0, i), value.slice(i + 1));
    }
    static joinPath(base: Uri, ...segments: string[]): Uri {
        return new Uri(base.scheme, [base.path, ...segments].join('/'));
    }
    get fsPath(): string {
        return this.path;
    }
    toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

export class Position {
    constructor(
        readonly line: number,
        readonly character: number,
    ) {}
}

export class Range {
    constructor(
        readonly start: Position,
        readonly end: Position,
    ) {}
}

/** Records the edits it is given, in order, so a test can read them back. */
export class WorkspaceEdit {
    readonly ops: { kind: 'insert' | 'replace'; uri: Uri; at: Range | Position; text: string }[] = [];
    insert(uri: Uri, position: Position, text: string): void {
        this.ops.push({ kind: 'insert', uri, at: position, text });
    }
    replace(uri: Uri, range: Range, text: string): void {
        this.ops.push({ kind: 'replace', uri, at: range, text });
    }
}

export class Diagnostic {
    source: string | undefined;
    code: string | number | undefined;
    constructor(
        public range: Range,
        public message: string,
        public severity: number,
    ) {}
}

export class RelativePattern {
    constructor(
        readonly base: unknown,
        readonly pattern: string,
    ) {}
}

export class ThemeColor {
    constructor(readonly id: string) {}
}

// ------------------------------------------------------------------ enums

export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3,
}
export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}
export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}
export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}
export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}
export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
}
export enum InlayHintKind {
    Type = 1,
    Parameter = 2,
}
export enum DecorationRangeBehavior {
    OpenOpen = 0,
    ClosedClosed = 1,
}
export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
}
export class CodeActionKind {
    static readonly QuickFix = new CodeActionKind('quickfix');
    constructor(readonly value: string) {}
}

// ------------------------------------------------------------- namespaces

const message =
    (kind: string) =>
    (...args: unknown[]): Promise<undefined> => {
        record(`window.${kind}`, args);
        return Promise.resolve(undefined);
    };

export const window = namespace('window', {
    showWarningMessage: message('showWarningMessage'),
    showErrorMessage: message('showErrorMessage'),
    showInformationMessage: message('showInformationMessage'),
    visibleTextEditors: [] as unknown[],
    activeTextEditor: undefined as unknown,
    async withProgress<R>(options: unknown, task: (progress: unknown) => Promise<R>): Promise<R> {
        record('window.withProgress', [options]);
        return task(stub('progress'));
    },
});

export const workspace = namespace('workspace', {
    get workspaceFolders() {
        return __workspace.folders;
    },
    textDocuments: [] as unknown[],
    // Reads, not registrations: how often a setting is read is not behaviour,
    // so it stays out of the log.
    getConfiguration: (_section?: string) => ({
        get: <T>(_key: string, fallback?: T): T | undefined => fallback,
        update: async (): Promise<void> => undefined,
    }),
    fs: {
        readFile: async (uri: Uri): Promise<Uint8Array> => {
            throw new Error(`ENOENT ${uri.path}`);
        },
        stat: async (uri: Uri): Promise<never> => {
            throw new Error(`ENOENT ${uri.path}`);
        },
        writeFile: async (): Promise<void> => undefined,
    },
});

export const languages = namespace('languages', {});
export const commands = namespace('commands', {});
export const env = namespace('env', {});
export const extensions = namespace('extensions', {
    getExtension: (id: string): undefined => {
        record('extensions.getExtension', [id]);
        return undefined;
    },
});

export const l10n = {
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
};
