import * as cp from 'child_process';
import { languagecheck } from './proto/checker';

const REQUEST_TIMEOUT_MS = 30_000;
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
    }>();
    private restartAttempts = 0;
    private stopped = false;
    private onRestartCallbacks: Array<() => void> = [];

    constructor(private binaryPath: string) {}

    /** Register a callback that fires after the client auto-restarts. */
    public onRestart(cb: () => void) {
        this.onRestartCallbacks.push(cb);
    }

    public get isRunning(): boolean {
        return this.process !== null && !this.stopped;
    }

    public start() {
        this.stopped = false;
        this.buffer = Buffer.alloc(0);

        this.process = cp.spawn(this.binaryPath, [], {
            stdio: ['pipe', 'pipe', 'inherit']
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            this.handleData(data);
        });

        this.process.on('error', (err) => {
            console.error('Failed to start language-check core:', err);
            this.attemptRestart();
        });

        this.process.on('exit', (code) => {
            console.log(`language-check core exited with code ${code}`);
            if (!this.stopped) {
                this.rejectAllPending('Process exited unexpectedly');
                this.attemptRestart();
            }
        });
    }

    private attemptRestart() {
        if (this.stopped || this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
            if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
                console.error(`language-check core failed after ${MAX_RESTART_ATTEMPTS} restart attempts`);
            }
            return;
        }

        this.restartAttempts++;
        console.log(`Restarting language-check core (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);

        setTimeout(() => {
            if (this.stopped) return;
            this.process = null;
            this.start();
            this.restartAttempts = 0; // Reset on successful start
            for (const cb of this.onRestartCallbacks) {
                try { cb(); } catch { /* ignore callback errors */ }
            }
        }, RESTART_DELAY_MS);
    }

    private rejectAllPending(reason: string) {
        for (const [_id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.pendingRequests.clear();
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
                pending.resolve(response);
                this.pendingRequests.delete(id);
            }
        }
    }

    public sendRequest(requestData: languagecheck.IRequest): Promise<languagecheck.Response> {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
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

            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${id} timed out after ${REQUEST_TIMEOUT_MS}ms`));
            }, REQUEST_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer });

            this.process.stdin.write(lengthBuf);
            this.process.stdin.write(msgData);
        });
    }

    public stop() {
        this.stopped = true;
        this.rejectAllPending('Client stopped');
        this.process?.kill();
        this.process = null;
    }
}
