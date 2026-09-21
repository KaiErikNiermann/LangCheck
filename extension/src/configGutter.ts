/**
 * Config status in the gutter, and under the value that caused it.
 *
 * A mark in the gutter means a probe ran and produced an outcome: the server
 * answered, the binary was found, the file was read, the rule name is real.
 * Anything the file settles on its own -- a key that is not a setting, a
 * duplicate block -- gets a squiggle and no mark. Without that split the
 * column fills with ticks next to enum checks, and a column that is always
 * green is one nobody reads.
 *
 * The marks reflect the buffer, not the saved file. That is deliberate and it
 * is not the same question `configEdits` pins: the engines still run under the
 * config on disk, and they should, but feedback about a URL has to arrive
 * while it is being typed to be worth anything.
 */
import * as vscode from 'vscode';

import { languagecheck } from './proto/checker';
import { parseConfigKeys, spanForKey, type KeySpan } from './configKeys';
import type { Logger } from './logger';

/** What a probe found, in the order a rollup should prefer. */
export type ConfigStatus = 'skipped' | 'ok' | 'degraded' | 'down' | 'pending';

/** One line's worth of state: what to draw, and what the hover says. */
export interface ConfigMark {
    readonly key: string;
    readonly status: ConfigStatus;
    /** Every detail that landed on this line, rolled up from its children. */
    readonly details: readonly string[];
    readonly line: number;
}

/** The whole model for one config document, and what the tests read. */
export interface ConfigStatusSnapshot {
    readonly uri: string;
    readonly marks: readonly ConfigMark[];
    readonly diagnostics: readonly { line: number; message: string; severity: string }[];
    /** Bumped on every applied render, so a test can wait for a change rather
     *  than for a duration. */
    readonly revision: number;
    readonly parseError: string;
}

const SEVERITY: Record<ConfigStatus, number> = {
    skipped: 0,
    pending: 1,
    ok: 2,
    degraded: 3,
    down: 4,
};

/** The worst of two outcomes, which is what an engine's own line shows. */
function worst(a: ConfigStatus, b: ConfigStatus): ConfigStatus {
    return SEVERITY[b] > SEVERITY[a] ? b : a;
}

function statusFromWire(status: languagecheck.ProbeStatus | number): ConfigStatus {
    switch (status) {
        case languagecheck.ProbeStatus.PROBE_STATUS_OK: return 'ok';
        case languagecheck.ProbeStatus.PROBE_STATUS_DEGRADED: return 'degraded';
        case languagecheck.ProbeStatus.PROBE_STATUS_DOWN: return 'down';
        default: return 'skipped';
    }
}

/**
 * How long to wait after a keystroke before probing.
 *
 * Long enough that typing a URL does not fire a request per character, short
 * enough that the answer still feels like it belongs to the edit. A probe can
 * take a network round trip on top of this, which is what the pending mark is
 * for.
 */
const PROBE_DEBOUNCE_MS = 600;

/** Config file names, as the core looks for them. */
const CONFIG_NAMES = ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json'];

export function isConfigDocument(document: vscode.TextDocument): boolean {
    const name = document.uri.path.split('/').pop() ?? '';
    return CONFIG_NAMES.includes(name);
}

type ProbeFn = (
    text: string,
    filePath: string,
    format: string,
) => Promise<languagecheck.IProbeConfigResponse | null>;

export class ConfigStatusView implements vscode.Disposable {
    private readonly decorations: Record<Exclude<ConfigStatus, 'skipped'>, vscode.TextEditorDecorationType>;
    private readonly diagnostics: vscode.DiagnosticCollection;
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly snapshots = new Map<string, ConfigStatusSnapshot>();
    private readonly subscriptions: vscode.Disposable[] = [];
    /** Guards against a slow probe overwriting a newer one's result. */
    private readonly inFlight = new Map<string, number>();
    private revision = 0;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly probe: ProbeFn,
        private readonly log: Logger,
    ) {
        this.decorations = {
            ok: this.gutter('check-circle-a.svg'),
            degraded: this.gutter('question-circle.svg'),
            down: this.gutter('x-circle.svg'),
            pending: this.gutter('pending-circle.svg'),
        };
        this.diagnostics = vscode.languages.createDiagnosticCollection('language-check-config');
    }

    private gutter(icon: string): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.joinPath(this.extensionUri, 'media', 'gutter', icon),
            gutterIconSize: 'contain',
            // The mark belongs to the line, not to the text on it, so it
            // stays put when the line is edited from either end.
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    /** Start watching. Every trigger that can change an answer is wired here. */
    public activate(): void {
        this.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (isConfigDocument(event.document)) this.schedule(event.document);
            }),
            vscode.workspace.onDidOpenTextDocument(document => {
                if (isConfigDocument(document)) this.schedule(document, 0);
            }),
            // A save is when the config the engines run under actually
            // changes, so it is worth re-asking even though the text has not
            // moved since the last keystroke.
            vscode.workspace.onDidSaveTextDocument(document => {
                if (isConfigDocument(document)) this.schedule(document, 0);
            }),
            vscode.window.onDidChangeVisibleTextEditors(() => this.renderAll()),
            vscode.workspace.onDidCloseTextDocument(document => this.forget(document)),
        );

        for (const document of vscode.workspace.textDocuments) {
            if (isConfigDocument(document)) this.schedule(document, 0);
        }
    }

    /**
     * Re-probe every open config.
     *
     * Called when something outside the file can have changed the answer --
     * the core restarting, a server coming up. The text has not changed, so
     * nothing here would fire on its own.
     */
    public refresh(): void {
        for (const document of vscode.workspace.textDocuments) {
            if (isConfigDocument(document)) this.schedule(document, 0);
        }
    }

    /** What is currently drawn, for the tests and for the status command. */
    public snapshot(uri: string): ConfigStatusSnapshot | undefined {
        return this.snapshots.get(uri);
    }

    /** Every config being tracked, for the status command with no argument. */
    public allSnapshots(): ConfigStatusSnapshot[] {
        return [...this.snapshots.values()];
    }

    private schedule(document: vscode.TextDocument, delay = PROBE_DEBOUNCE_MS): void {
        const uri = document.uri.toString();
        const existing = this.timers.get(uri);
        if (existing) clearTimeout(existing);
        this.timers.set(uri, setTimeout(() => {
            this.timers.delete(uri);
            void this.run(document);
        }, delay));
    }

    private forget(document: vscode.TextDocument): void {
        const uri = document.uri.toString();
        const timer = this.timers.get(uri);
        if (timer) clearTimeout(timer);
        this.timers.delete(uri);
        this.snapshots.delete(uri);
        this.inFlight.delete(uri);
        this.diagnostics.delete(document.uri);
    }

    private async run(document: vscode.TextDocument): Promise<void> {
        const uri = document.uri.toString();
        const text = document.getText();
        const parsed = parseConfigKeys(text);

        // Drawn before the request goes out, so a slow server reads as "still
        // asking" instead of as a stale green from the last answer.
        this.apply(document, parsed, [], [], '', 'pending');

        const generation = (this.inFlight.get(uri) ?? 0) + 1;
        this.inFlight.set(uri, generation);

        const format = document.uri.path.endsWith('.json') ? 'json' : 'yaml';
        let response: languagecheck.IProbeConfigResponse | null = null;
        try {
            response = await this.probe(text, document.uri.fsPath, format);
        } catch (error) {
            this.log.warn(`Config probe failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        // A newer edit already started its own probe; this answer is about
        // text that is no longer on screen. `forget` clears the generation
        // too, so a document closed mid-probe is covered by the same check
        // and its answer is not resurrected into an empty snapshot.
        if (this.inFlight.get(uri) !== generation) return;
        if (response === null) return;

        this.apply(
            document,
            parsed,
            response.probes ?? [],
            response.issues ?? [],
            response.parseError ?? '',
            'ok',
        );
    }

    /**
     * Turn probes into marks and squiggles, and draw them.
     *
     * `fallback` is what a key with no probe gets, which is `pending` on the
     * pass before the answer arrives and never used after it.
     */
    private apply(
        document: vscode.TextDocument,
        parsed: ReturnType<typeof parseConfigKeys>,
        probes: readonly languagecheck.IConfigProbe[],
        issues: readonly languagecheck.IConfigIssue[],
        parseError: string,
        fallback: ConfigStatus,
    ): void {
        const byLine = new Map<number, { status: ConfigStatus; details: string[]; key: string }>();
        const diagnostics: vscode.Diagnostic[] = [];
        /** Block-level squiggles, held back until the leaves have spoken. */
        const blockSquiggles: vscode.Diagnostic[] = [];
        const blockEngines: string[] = [];
        const enginesWithLeafSquiggle = new Set<string>();

        const lineOf = (span: KeySpan) => document.positionAt(span.keyStart).line;

        const mark = (line: number, key: string, status: ConfigStatus, detail: string) => {
            const existing = byLine.get(line);
            if (existing === undefined) {
                byLine.set(line, { status, details: detail ? [detail] : [], key });
                return;
            }
            existing.status = worst(existing.status, status);
            if (detail && !existing.details.includes(detail)) existing.details.push(detail);
        };

        for (const probe of probes) {
            const key = probe.key ?? '';
            const span = spanForKey(parsed.spans, key);
            if (span === undefined) continue;
            const status = statusFromWire(probe.status ?? 0);
            const detail = probe.detail ?? '';
            if (status === 'skipped') {
                // Drawn as nothing. An engine that is off is not a failure and
                // a grey tick next to it would only add noise.
                continue;
            }
            mark(lineOf(span), key, status, detail);

            // The engine's own line carries the rollup, so a broken URL turns
            // the block header as well as the URL. The reason travels with it:
            // a header that goes red and then explains itself with "Harper is
            // built in and always available" is worse than no hover at all.
            const engine = probe.engine ?? '';
            if (engine && key !== `engines.${engine}`) {
                const header = spanForKey(parsed.spans, `engines.${engine}`);
                if (header) {
                    mark(
                        lineOf(header),
                        `engines.${engine}`,
                        status,
                        status === 'ok' ? '' : detail,
                    );
                }
            }

            if (status === 'down' || status === 'degraded') {
                const isBlock = engine !== '' && key === `engines.${engine}`;
                // The mark summarises and the squiggle localises. A block
                // whose leaf already carries the same sentence would
                // otherwise underline `languagetool:` and the URL under it
                // with one message, and the reader has to work out that they
                // are the same finding. A block with no leaf -- Vale missing
                // from PATH -- still squiggles, on its key.
                (isBlock ? blockSquiggles : diagnostics).push(squiggle(
                    document,
                    span,
                    detail,
                    status,
                    probe.blamesKey === true,
                ));
                if (!isBlock && engine !== '') enginesWithLeafSquiggle.add(engine);
                if (isBlock) blockEngines.push(engine);
            }
        }

        // Added last, and only for engines whose leaves said nothing.
        for (const [index, engine] of blockEngines.entries()) {
            if (enginesWithLeafSquiggle.has(engine)) continue;
            const diagnostic = blockSquiggles[index];
            if (diagnostic) diagnostics.push(diagnostic);
        }

        // Text-decidable findings: a squiggle and no mark.
        for (const issue of issues) {
            const span = spanForKey(parsed.spans, issue.key ?? '');
            if (span === undefined) continue;
            diagnostics.push(squiggle(
                document,
                span,
                issue.message ?? '',
                issue.severity === languagecheck.Severity.SEVERITY_ERROR ? 'down' : 'degraded',
                /* underlineKey */ true,
            ));
        }

        for (const problem of parsed.problems) {
            const range = new vscode.Range(
                document.positionAt(problem.start),
                document.positionAt(Math.max(problem.end, problem.start + 1)),
            );
            const diagnostic = new vscode.Diagnostic(
                range,
                problem.message,
                problem.fatal
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning,
            );
            diagnostic.source = 'language-check';
            diagnostics.push(diagnostic);
        }

        if (parseError) {
            const range = new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length));
            const diagnostic = new vscode.Diagnostic(
                range,
                parseError,
                vscode.DiagnosticSeverity.Error,
            );
            diagnostic.source = 'language-check';
            diagnostics.push(diagnostic);
        }

        // Only on the first pass, while the answer is outstanding: give every
        // probe-worthy key that exists a pending mark so the column appears at
        // once rather than filling in from empty.
        if (fallback === 'pending' && probes.length === 0) {
            for (const key of parsed.spans.keys()) {
                if (!PROBE_WORTHY.test(key)) continue;
                const span = parsed.spans.get(key);
                if (span) mark(lineOf(span), key, 'pending', '');
            }
        }

        const marks: ConfigMark[] = [...byLine.entries()]
            .map(([line, entry]) => ({
                line,
                key: entry.key,
                status: entry.status,
                details: entry.details,
            }))
            .sort((a, b) => a.line - b.line);

        this.revision += 1;
        this.snapshots.set(document.uri.toString(), {
            uri: document.uri.toString(),
            marks,
            diagnostics: diagnostics.map(d => ({
                line: d.range.start.line,
                message: d.message,
                severity: vscode.DiagnosticSeverity[d.severity],
            })),
            revision: this.revision,
            parseError,
        });

        // The block and the leaf can carry the same sentence -- a URL nothing
        // answers on is reported against both -- and two identical underlines
        // on one line is just a darker underline.
        const seen = new Set<string>();
        const unique = diagnostics.filter(d => {
            const key = `${d.range.start.line}:${d.range.start.character}:`
                + `${d.range.end.line}:${d.range.end.character}:${d.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        this.diagnostics.set(document.uri, unique);
        this.renderAll();
    }

    /** Push the model to every editor showing one of these documents. */
    private renderAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            const snapshot = this.snapshots.get(editor.document.uri.toString());
            if (snapshot === undefined) continue;
            for (const status of ['ok', 'degraded', 'down', 'pending'] as const) {
                const ranges = snapshot.marks
                    .filter(m => m.status === status)
                    .map(m => {
                        const line = editor.document.lineAt(
                            Math.min(m.line, editor.document.lineCount - 1),
                        );
                        return new vscode.Range(line.range.start, line.range.start);
                    });
                // Built without the key when there is no hover: under
                // `exactOptionalPropertyTypes` an explicit `undefined` is not
                // the same as an absent property.
                editor.setDecorations(this.decorations[status], ranges.map(range => {
                    const hoverMessage = hoverFor(snapshot, range.start.line);
                    return hoverMessage === undefined
                        ? { range }
                        : { range, hoverMessage };
                }));
            }
        }
    }

    public dispose(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const decoration of Object.values(this.decorations)) decoration.dispose();
        this.diagnostics.dispose();
        for (const subscription of this.subscriptions) subscription.dispose();
    }
}

/**
 * Keys that can be probed at all, for the pending pass.
 *
 * The core decides what it probes; this only has to know which lines are
 * going to get an answer, so it can show that one is coming.
 */
const PROBE_WORTHY = /^engines\.(harper|languagetool|vale|proselint|hunspell|spell_language)(\.(url|config|mother_tongue|linters\.[^.]+))?$/;

function squiggle(
    document: vscode.TextDocument,
    span: KeySpan,
    message: string,
    status: 'down' | 'degraded',
    underlineKey = false,
): vscode.Diagnostic {
    // The value is what is wrong when a probe failed, and the key is what is
    // wrong when the key itself is not a setting.
    //
    // A key whose value is a nested block is the third case: underlining the
    // value there covers every line of the block, which reads as a complaint
    // about all of it. `languagetool:` failing to connect is about the block,
    // so the key is what carries it -- the URL inside gets its own squiggle
    // on its own value.
    const spansLines = document.positionAt(span.valueStart).line
        !== document.positionAt(span.valueEnd).line;
    const [start, end] = underlineKey || spansLines
        ? [span.keyStart, span.keyEnd]
        : [span.valueStart, span.valueEnd];
    const range = new vscode.Range(
        document.positionAt(start),
        document.positionAt(Math.max(end, start + 1)),
    );
    const diagnostic = new vscode.Diagnostic(
        range,
        message,
        status === 'down' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'language-check';
    return diagnostic;
}

function hoverFor(snapshot: ConfigStatusSnapshot, line: number): vscode.MarkdownString | undefined {
    const mark = snapshot.marks.find(m => m.line === line);
    if (mark === undefined || mark.details.length === 0) return undefined;
    const markdown = new vscode.MarkdownString(mark.details.join('\n\n'));
    markdown.isTrusted = false;
    return markdown;
}
