import * as cp from 'child_process';
import { languagecheck } from './proto/checker';
import type { TraceLogger } from './trace';
import type { Logger } from './logger';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 1000;

export class LanguageClient {
    private process: cp.ChildProcess | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private nextId = 1;
    private pendingRequests = new Map<number, {
        resolve: (res: languagecheck.Response) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        startTime: number;
    }>();
    private restartAttempts = 0;
    private stopped = false;
    private onRestartCallbacks: Array<() => void> = [];
    private trace: TraceLogger | null = null;
    private log: Logger | null = null;
    /** Set once the client stops retrying. While non-null the core is known to
     *  be unreachable, so requests fail immediately instead of waiting out
     *  REQUEST_TIMEOUT_MS against a process that can never answer. */
    private failureReason: string | null = null;
    private onFailureCallbacks: Array<(reason: string) => void> = [];

    constructor(private binaryPath: string) {}

    /** Attach a trace logger for debugging protobuf traffic. */
    public setTraceLogger(logger: TraceLogger): void {
        this.trace = logger;
    }

    /** Attach the extension's output-channel logger.
     *
     *  Optional, mirroring `setTraceLogger`, so tests can construct a client with no VS Code
     *  window. In the extension it is always set — the messages below are the core-crashed and
     *  core-restarting paths, which are the ones a user is asked to paste into a bug report. */
    public setLogger(logger: Logger): void {
        this.log = logger;
    }

    /** Register a callback that fires after the client auto-restarts. */
    public onRestart(cb: () => void) {
        this.onRestartCallbacks.push(cb);
    }

    /** Register a callback that fires when the client gives up restarting.
     *  Nothing will work until `start()` is called again. */
    public onFailure(cb: (reason: string) => void) {
        this.onFailureCallbacks.push(cb);
    }

    public get isRunning(): boolean {
        return this.process !== null && !this.stopped && this.failureReason === null;
    }

    /** Why the client gave up, or `null` while it is healthy. */
    public get lastFailure(): string | null {
        return this.failureReason;
    }

    public start() {
        this.stopped = false;
        this.failureReason = null;
        this.buffer = Buffer.alloc(0);
        this.detach(this.process);

        this.process = cp.spawn(this.binaryPath, [], {
            stdio: ['pipe', 'pipe', 'inherit']
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            this.handleData(data);
        });

        // Writing to a core that has gone away fails asynchronously with EPIPE.
        // Without a listener Node escalates that to an uncaught exception in the
        // extension host, so claim it and fail the requests it stranded.
        this.process.stdin?.on('error', (err: Error) => {
            this.trace?.logEvent(`stdin error: ${err.message}`);
            this.rejectAllPending(`Failed to write to language-check core: ${err.message}`);
        });

        this.process.on('error', (err) => {
            this.log?.error('Failed to start core', { binary: this.binaryPath, err: String(err) });
            this.trace?.logEvent(`Process error: ${err.message}`);
            this.attemptRestart(err.message);
        });

        this.process.on('exit', (code) => {
            this.log?.warn('Core process exited', { code });
            this.trace?.logEvent(`Process exited with code ${code}`);
            if (!this.stopped) {
                this.rejectAllPending('Process exited unexpectedly');
                this.attemptRestart(`process exited with code ${code}`);
            }
        });
    }

    /** Drop every listener on a superseded handle so a late event from the old
     *  process can't reject requests belonging to its replacement. */
    private detach(proc: cp.ChildProcess | null) {
        if (!proc) return;
        proc.removeAllListeners();
        proc.stdout?.removeAllListeners();
        proc.stdin?.removeAllListeners();
    }

    private attemptRestart(cause: string) {
        if (this.stopped) return;

        if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
            this.giveUp(
                `language-check core failed after ${MAX_RESTART_ATTEMPTS} restart attempts: ${cause}`,
            );
            return;
        }

        this.restartAttempts++;
        this.log?.info('Restarting core', { attempt: this.restartAttempts, max: MAX_RESTART_ATTEMPTS });

        setTimeout(() => {
            if (this.stopped) return;
            this.start();
            // Only reset attempts and fire callbacks after the process
            // survives for a reasonable duration (not an instant crash).
            const resetTimer = setTimeout(() => {
                if (this.process && !this.stopped) {
                    this.restartAttempts = 0;
                }
            }, 5000);
            // Don't let this timer keep the process alive
            resetTimer.unref?.();
            for (const cb of this.onRestartCallbacks) {
                try { cb(); } catch { /* ignore callback errors */ }
            }
        }, RESTART_DELAY_MS);
    }

    /** Enter the terminal failure state: stop pretending the core is alive, and
     *  settle everything in flight so callers learn now rather than one request
     *  timeout later. */
    private giveUp(reason: string) {
        if (this.failureReason !== null) return;
        this.failureReason = reason;

        // Drop the dead handle — while it is still assigned, `isRunning` reports
        // healthy and `sendRequest` happily writes into a pipe nobody reads.
        this.detach(this.process);
        this.process = null;

        this.log?.error('Core unavailable', { reason });
        this.trace?.logEvent(`Core unavailable: ${reason}`);
        this.rejectAllPending(reason);

        for (const cb of this.onFailureCallbacks) {
            try { cb(reason); } catch { /* ignore callback errors */ }
        }
    }

    private rejectAllPending(reason: string) {
        for (const [_id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.pendingRequests.clear();
    }

    /** Settle a single in-flight request with an error. */
    private failRequest(id: number, err: Error) {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        pending.reject(err);
    }

    private handleData(data: Buffer) {
        this.buffer = Buffer.concat([this.buffer, data]);

        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (this.buffer.length < 4 + length) {
                break;
            }

            const msgData = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);

            const response = languagecheck.Response.decode(msgData);
            const id = typeof response.id === 'number' ? response.id : Number(response.id);
            const pending = this.pendingRequests.get(id);
            if (pending) {
                clearTimeout(pending.timer);
                const durationMs = Date.now() - pending.startTime;
                this.trace?.logResponse(response, durationMs);
                pending.resolve(response);
                this.pendingRequests.delete(id);
            }
        }
    }

    public sendRequest(requestData: languagecheck.IRequest): Promise<languagecheck.Response> {
        return new Promise((resolve, reject) => {
            if (this.failureReason !== null) {
                return reject(new Error(this.failureReason));
            }
            const stdin = this.process?.stdin;
            if (this.stopped || !stdin) {
                return reject(new Error('Process not started'));
            }

            const id = this.nextId++;
            const request = languagecheck.Request.create({
                ...requestData,
                id
            });

            const msgData = languagecheck.Request.encode(request).finish();
            const lengthBuf = Buffer.alloc(4);
            lengthBuf.writeUInt32BE(msgData.length, 0);

            this.trace?.logRequest(request);

            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${id} timed out after ${REQUEST_TIMEOUT_MS}ms`));
            }, REQUEST_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer, startTime: Date.now() });

            stdin.write(lengthBuf);
            // Report a failed write against this request directly: otherwise it
            // sits in `pendingRequests` for the full timeout even though the
            // bytes never reached the core.
            stdin.write(msgData, (err) => {
                if (err) this.failRequest(id, err);
            });
        });
    }

    public stop() {
        this.stopped = true;
        this.rejectAllPending('Client stopped');
        const proc = this.process;
        this.process = null;
        this.detach(proc);
        proc?.kill();
    }
}
