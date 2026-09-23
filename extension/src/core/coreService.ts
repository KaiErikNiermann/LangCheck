/**
 * The core process: starting it, initializing it, and knowing whether it is
 * fit to be asked anything.
 */
import * as fs from 'fs';
import * as vscode from 'vscode';

import { COMMANDS, executeCommand } from '../commands/ids';
import { getSetting } from '../config/settings';
import type { Logger } from '../shared/logger';
import type { TraceLogger } from '../shared/trace';
import type { InspectorLog } from '../ui/inspectorLog';
import type { StatusBars } from '../ui/statusBars';
import { resolveBinaryPath } from './binary';
import { LanguageClient } from './client';
import { conflictLogLines, identityOf } from './initializeReport';
import type { languagecheck } from '../proto/checker';

declare const initialized: unique symbol;

/**
 * A client whose Initialize has returned.
 *
 * The distinction is the whole reason this type exists. `client` is set the
 * moment the process is spawned, but Initialize is what loads the config, the
 * user dictionary and the ignore store -- and the core answers other requests
 * while it is still doing that. A check that raced it came back with the
 * dictionary empty, so every word the user had added was reported as a
 * misspelling, on exactly the first check after opening a window. Nothing
 * retried it, because the answer was not an error.
 *
 * Only {@link CoreService.ready} produces one, so code that takes a
 * `ReadyClient` cannot be handed a client that is still starting.
 */
export type ReadyClient = LanguageClient & { readonly [initialized]: true };

/** What the rest of the extension does when the core comes up. */
export interface CoreHooks {
    /** After a start from scratch has finished its Initialize. */
    booted(): void;
    /** After the client restarted a crashed process and re-initialized it. */
    restarted(): void;
}

export class CoreService {
    private current: LanguageClient | null = null;
    private initialized = false;
    /**
     * What Initialize has already warned about this session. A config change
     * re-initializes, and the same notification on every save would be noise.
     */
    private readonly warnedAbout = new Set<string>();
    /**
     * File extensions that only an SLS schema handles, as the core reports them.
     *
     * Asked for after each Initialize, because a schema added or edited while
     * the editor is open changes the answer.
     */
    private schemaExtensionSet = new Set<string>();
    /** The core binary in use, which is where the CLI sits beside it. */
    private serverPath: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly log: Logger,
        private readonly inspectorLog: InspectorLog,
        private readonly statusBars: StatusBars,
        readonly traceLogger: TraceLogger,
        private readonly hooks: CoreHooks,
    ) {}

    /** The client, started or not, initialized or not. */
    get client(): LanguageClient | null {
        return this.current;
    }

    /** The client, only once it has finished Initialize. */
    ready(): ReadyClient | undefined {
        return this.current && this.initialized ? (this.current as ReadyClient) : undefined;
    }

    get schemaExtensions(): ReadonlySet<string> {
        return this.schemaExtensionSet;
    }

    get currentServerPath(): string | undefined {
        return this.serverPath;
    }

    /** Replace any running process with a fresh one. It is not initialized until {@link initialize}. */
    start(channel?: string): void {
        if (this.current) {
            this.log.debug('Stopping existing client');
            this.current.stop();
        }
        const binaryPath = resolveBinaryPath(this.context, channel);
        this.serverPath = binaryPath;
        this.log.info('Starting core', { binary: binaryPath, channel: channel ?? 'stable' });
        this.initialized = false;
        const client = new LanguageClient(binaryPath);
        this.current = client;
        client.setLogger(this.log);
        client.setTraceLogger(this.traceLogger);
        client.onRestart(async () => {
            try {
                await this.initialize();
            } catch (err) {
                this.reportInitializeFailure('Core initialize failed after the process was restarted', err);
                return;
            }
            this.hooks.restarted();
        });
        client.onFailure(reason => this.reportFailure(reason, binaryPath));
        client.start();
        this.traceLogger.logEvent(`Core started: ${binaryPath} (channel: ${channel ?? 'stable'})`);
    }

    /** Send Initialize, then ask which extensions the schemas claim. */
    async initialize(): Promise<void> {
        const client = this.current;
        if (client && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const root = vscode.workspace.workspaceFolders[0]!.uri.fsPath;
            const indexOnOpen = getSetting('workspace.indexOnOpen');
            const dbPath = getSetting('workspace.dbPath') || null;
            const detectNames = getSetting('names.enabled');
            const dictionariesBundled = getSetting('dictionaries.bundled');
            const dictionariesDisabled = getSetting('dictionaries.disabled');
            const dictionariesPaths = getSetting('dictionaries.paths');
            this.log.debug('Sending Initialize request', { workspaceRoot: root, indexOnOpen, dbPath, detectNames, dictionariesBundled, dictionariesDisabled, dictionariesPaths });
            this.inspectorLog.push('info', 'initialize', `Initializing (indexOnOpen=${indexOnOpen}, detectNames=${detectNames})`);
            const t0 = performance.now();
            const response = await client.sendRequest({
                initialize: {
                    workspaceRoot: root, indexOnOpen, dbPath, detectNames,
                    dictionariesBundled, dictionariesDisabled, dictionariesPaths
                }
            });
            this.inspectorLog.push('info', 'initialize', 'Server initialized', { durationMs: performance.now() - t0 });
            this.log.debug('Initialize response received');
            this.reportInitializeAnswer(response);
        }
        // Which extensions the schemas claim, which only the core knows and
        // which a schema edit changes. Read at call time, not above: a restart
        // during the Initialize await replaces the client.
        if (this.current) {
            try {
                const metadata = await this.current.sendRequest({ getMetadata: {} });
                this.schemaExtensionSet = new Set(
                    (metadata.getMetadata?.schemaExtensions ?? []).map(e => e.toLowerCase()),
                );
                this.log.debug('Schema extensions', { extensions: [...this.schemaExtensionSet] });
            } catch (err) {
                // Not fatal: without it only the built-in languages are
                // checked, which is what happened before this existed.
                this.log.warn('Could not read core metadata', { err: String(err) });
            }
        }
        this.initialized = true;
    }

    /** Start from scratch, initialize, then let the rest of the extension catch up. */
    async boot(): Promise<void> {
        this.start();
        await this.initialize();
        this.hooks.booted();
    }

    /**
     * Start again and initialize without waiting for it.
     *
     * What the restart, download and channel-switch commands have always
     * done. Unlike {@link boot}, nothing is re-checked afterwards.
     */
    restart(channel?: string): void {
        this.start(channel);
        this.initialize().catch(err => this.reportInitializeFailure('Core initialize failed after a restart', err));
    }

    /**
     * Tell the user what the core could not set up.
     *
     * The answer used to be read by nobody: an Initialize that failed looked
     * like one that worked, and a second server on the same workspace ran
     * without its index while nothing said a second server existed. The log
     * gets the whole of it, with both servers' process ids and paths; the
     * notification says what happened and opens the log.
     */
    private reportInitializeAnswer(response: languagecheck.IResponse): void {
        if (response.error) {
            const message = response.error.message ?? '';
            this.log.error('Initialize failed', { message });
            this.inspectorLog.push('error', 'initialize', message);
            this.notifyOnce(`error:${message}`, vscode.l10n.t('Language Check could not set up its checker: {0}', message));
            return;
        }
        // An older core answers Ok, and has nothing more to say.
        const answer = response.initialize;
        if (!answer) return;

        const self = identityOf(answer.thisServer);
        const other = identityOf(answer.otherServer);
        if (other) {
            for (const line of conflictLogLines(other, self)) this.log.warn(line);
            this.inspectorLog.push('warn', 'initialize', `Another language-check server (pid ${other.pid}) holds this workspace's index`);
            this.notifyOnce(
                `server:${other.pid}:${other.executable}`,
                vscode.l10n.t(
                    "Another language-check server (process {0}, version {1}) is using this workspace's index: {2}. This window's server (process {3}) runs without it.",
                    other.pid, other.version || '?', other.executable || '?', self?.pid ?? '?',
                ),
            );
        }
        for (const warning of answer.warnings ?? []) {
            this.log.warn(warning);
            this.inspectorLog.push('warn', 'initialize', warning);
            // The core's own sentence about the index, when it named the
            // holder, is what the notification above already says.
            if (!other) this.notifyOnce(`warning:${warning}`, vscode.l10n.t('Language Check: {0}', warning));
        }
    }

    /** A warning with a way to the log, once per session; not awaited, so Initialize never waits on a click. */
    private notifyOnce(key: string, message: string): void {
        if (this.warnedAbout.has(key)) return;
        this.warnedAbout.add(key);
        const showLog = vscode.l10n.t('Show Log');
        void Promise.resolve(vscode.window.showWarningMessage(message, showLog)).then(choice => {
            if (choice === showLog) this.log.show();
        });
    }

    /**
     * Log an Initialize nobody is awaiting.
     *
     * These run from commands and from the client's own recovery, where there
     * is no caller to hand the error to; left alone it surfaces only as an
     * unhandled rejection in the extension host log.
     */
    private reportInitializeFailure(message: string, err: unknown): void {
        this.log.warn(message, { err: String(err) });
        this.inspectorLog.push('error', 'initialize', `${message}: ${String(err)}`);
    }

    /**
     * Ask the core what the config's external references resolve to.
     *
     * Returns null when there is no core to ask, which the view draws as
     * nothing rather than as a failure: "the server is not running" is not an
     * answer about the user's config.
     */
    async probeConfig(text: string, filePath: string, format: string) {
        const client = this.ready();
        if (!client) return null;
        const response = await client.sendRequest({
            probeConfig: { text, filePath, format },
        });
        return response.probeConfig ?? null;
    }

    /**
     * Which config is in force and which files it selects, as the CLI's
     * `config files --skipped` reports it. Null when there is no core to ask.
     */
    async listConfigFiles() {
        const client = this.ready();
        if (!client) return null;
        const response = await client.sendRequest({ listConfigFiles: {} });
        return response.listConfigFiles ?? null;
    }

    stop(): void {
        if (this.current) {
            this.current.stop();
            this.current = null;
        }
    }

    /** Surface a core that has stopped retrying. Until it is restarted nothing
     *  will check, so say so plainly instead of leaving a silent dead client. */
    private async reportFailure(reason: string, binaryPath: string): Promise<void> {
        this.log.error('Core unavailable', { reason, binary: binaryPath });
        this.inspectorLog.push('error', 'core', reason, { details: binaryPath });
        this.statusBars.setChecking(false);

        const message = fs.existsSync(binaryPath)
            ? vscode.l10n.t('Language Check core stopped responding: {0}', reason)
            : vscode.l10n.t('Language Check core binary not found at {0}', binaryPath);
        const restart = vscode.l10n.t('Restart Core');
        const selection = await vscode.window.showErrorMessage(message, restart);
        if (selection === restart) {
            executeCommand(COMMANDS.restartLanguageServer);
        }
    }
}
