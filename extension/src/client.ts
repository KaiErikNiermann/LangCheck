import * as cp from 'child_process';
import * as path from 'path';
import { languagecheck } from './proto/checker';

export class LanguageClient {
    private process: cp.ChildProcess | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private nextId = 1;
    private pendingRequests = new Map<number, (res: languagecheck.Response) => void>();

    constructor(private binaryPath: string) {}

    public start() {
        this.process = cp.spawn(this.binaryPath, [], {
            stdio: ['pipe', 'pipe', 'inherit']
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            this.handleData(data);
        });

        this.process.on('error', (err) => {
            console.error('Failed to start language-check core:', err);
        });

        this.process.on('exit', (code) => {
            console.log(`language-check core exited with code ${code}`);
        });
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
            const callback = this.pendingRequests.get(response.id as number);
            if (callback) {
                callback(response);
                this.pendingRequests.delete(response.id as number);
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

            this.process.stdin.write(lengthBuf);
            this.process.stdin.write(msgData);

            this.pendingRequests.set(id, resolve);
        });
    }

    public stop() {
        this.process?.kill();
        this.process = null;
    }
}
