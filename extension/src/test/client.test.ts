import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LanguageClient } from '../client';
import { languagecheck } from '../proto/checker';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process');

function createMockProcess() {
    const mockStdout = new EventEmitter();
    const mockStdin = { write: vi.fn() };
    const processEmitter = new EventEmitter();
    const mockProcess = Object.assign(processEmitter, {
        stdout: mockStdout,
        stdin: mockStdin,
        kill: vi.fn(),
        pid: 1234,
    });
    return { mockProcess, mockStdout, mockStdin };
}

function encodeResponse(response: languagecheck.IResponse): Buffer {
    const data = languagecheck.Response.encode(
        languagecheck.Response.create(response)
    ).finish();
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(data.length, 0);
    return Buffer.concat([lengthBuf, Buffer.from(data)]);
}

/** Convert protobuf Long | number to plain number for comparison. */
function toNum(val: unknown): number {
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && 'toNumber' in val) {
        return (val as { toNumber(): number }).toNumber();
    }
    return Number(val);
}

describe('LanguageClient', () => {
    let client: LanguageClient;
    let mock: ReturnType<typeof createMockProcess>;

    beforeEach(() => {
        mock = createMockProcess();
        (cp.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mock.mockProcess);
        client = new LanguageClient('mock-binary');
    });

    afterEach(() => {
        // Stop quietly - suppress unhandled rejections from pending requests
        // that were already handled by the test (e.g. restart/timeout tests).
        if (client.isRunning) {
            client.stop();
        }
        vi.restoreAllMocks();
    });

    describe('start/stop lifecycle', () => {
        it('should not be running before start', () => {
            expect(client.isRunning).toBe(false);
        });

        it('should be running after start', () => {
            client.start();
            expect(client.isRunning).toBe(true);
        });

        it('should spawn the binary with pipe stdio', () => {
            client.start();
            expect(cp.spawn).toHaveBeenCalledWith('mock-binary', [], {
                stdio: ['pipe', 'pipe', 'inherit'],
            });
        });

        it('should not be running after stop', () => {
            client.start();
            client.stop();
            expect(client.isRunning).toBe(false);
        });

        it('should kill the process on stop', () => {
            client.start();
            client.stop();
            expect(mock.mockProcess.kill).toHaveBeenCalled();
        });
    });

    describe('request/response round-trip', () => {
        it('should frame and send a request correctly', () => {
            client.start();
            // Fire-and-forget: we're testing the framing, not the response
            client.sendRequest({
                checkProse: { text: 'Hello world', languageId: 'markdown' },
            }).catch(() => {}); // Will be rejected on stop

            expect(mock.mockStdin.write).toHaveBeenCalledTimes(2); // length prefix + data
            const lengthBuf = mock.mockStdin.write.mock.calls[0]![0] as Buffer;
            expect(lengthBuf.length).toBe(4);
            const msgBuf = mock.mockStdin.write.mock.calls[1]![0] as Uint8Array;
            const decoded = languagecheck.Request.decode(msgBuf);
            expect(toNum(decoded.id)).toBe(1);
            expect(decoded.checkProse?.text).toBe('Hello world');
        });

        it('should resolve promise when response arrives', async () => {
            client.start();
            const promise = client.sendRequest({
                checkProse: { text: 'Test', languageId: 'markdown' },
            });

            // Simulate server response for request id=1
            const frame = encodeResponse({
                id: 1,
                checkProse: {
                    diagnostics: [
                        {
                            message: 'Test diagnostic',
                            startByte: 0,
                            endByte: 4,
                            ruleId: 'test.rule',
                            severity: languagecheck.Severity.SEVERITY_WARNING,
                        },
                    ],
                },
            });
            mock.mockStdout.emit('data', frame);

            const response = await promise;
            expect(toNum(response.id)).toBe(1);
            expect(response.checkProse?.diagnostics).toHaveLength(1);
            expect(response.checkProse?.diagnostics?.[0]?.message).toBe('Test diagnostic');
        });

        it('should handle multiple pending requests', async () => {
            client.start();
            const p1 = client.sendRequest({
                checkProse: { text: 'First', languageId: 'markdown' },
            });
            const p2 = client.sendRequest({
                checkProse: { text: 'Second', languageId: 'markdown' },
            });

            // Respond to second request first (out of order)
            mock.mockStdout.emit('data', encodeResponse({
                id: 2,
                checkProse: { diagnostics: [] },
            }));
            mock.mockStdout.emit('data', encodeResponse({
                id: 1,
                checkProse: { diagnostics: [{ message: 'Issue', startByte: 0, endByte: 1, ruleId: 'r', severity: 1 }] },
            }));

            const [r1, r2] = await Promise.all([p1, p2]);
            expect(toNum(r1.id)).toBe(1);
            expect(r1.checkProse?.diagnostics).toHaveLength(1);
            expect(toNum(r2.id)).toBe(2);
            expect(r2.checkProse?.diagnostics).toHaveLength(0);
        });

        it('should increment request IDs', () => {
            client.start();
            client.sendRequest({ getMetadata: {} }).catch(() => {});
            client.sendRequest({ getMetadata: {} }).catch(() => {});
            client.sendRequest({ getMetadata: {} }).catch(() => {});

            // Each call writes 2 buffers (length + data), so data buffers are at indices 1, 3, 5
            const ids = [1, 3, 5].map((i) => {
                const msgBuf = mock.mockStdin.write.mock.calls[i]![0] as Uint8Array;
                return toNum(languagecheck.Request.decode(msgBuf).id);
            });
            expect(ids).toEqual([1, 2, 3]);
        });
    });

    describe('message framing', () => {
        it('should handle fragmented data (split across chunks)', async () => {
            client.start();
            const promise = client.sendRequest({ getMetadata: {} });

            const frame = encodeResponse({
                id: 1,
                getMetadata: { name: 'Test', version: '1.0', supportedLanguages: [] },
            });

            // Split the frame into multiple chunks
            const mid = Math.floor(frame.length / 2);
            mock.mockStdout.emit('data', frame.subarray(0, mid));
            mock.mockStdout.emit('data', frame.subarray(mid));

            const response = await promise;
            expect(response.getMetadata?.name).toBe('Test');
        });

        it('should handle multiple messages in a single chunk', async () => {
            client.start();
            const p1 = client.sendRequest({ getMetadata: {} });
            const p2 = client.sendRequest({ getMetadata: {} });

            const frame1 = encodeResponse({ id: 1, getMetadata: { name: 'A', version: '1', supportedLanguages: [] } });
            const frame2 = encodeResponse({ id: 2, getMetadata: { name: 'B', version: '2', supportedLanguages: [] } });

            // Send both frames in one chunk
            mock.mockStdout.emit('data', Buffer.concat([frame1, frame2]));

            const [r1, r2] = await Promise.all([p1, p2]);
            expect(r1.getMetadata?.name).toBe('A');
            expect(r2.getMetadata?.name).toBe('B');
        });
    });

    describe('error handling', () => {
        it('should reject with error when process not started', async () => {
            await expect(client.sendRequest({ getMetadata: {} })).rejects.toThrow(
                'Process not started'
            );
        });

        it('should reject with error when process stopped', async () => {
            client.start();
            client.stop();
            await expect(client.sendRequest({ getMetadata: {} })).rejects.toThrow(
                'Process not started'
            );
        });

        it('should reject pending requests on stop', async () => {
            client.start();
            const promise = client.sendRequest({ getMetadata: {} });
            client.stop();
            await expect(promise).rejects.toThrow('Client stopped');
        });
    });

    describe('request timeout', () => {
        it('should reject after timeout', async () => {
            vi.useFakeTimers();
            try {
                client.start();
                const promise = client.sendRequest({ getMetadata: {} });

                // Advance past the 30s timeout
                vi.advanceTimersByTime(30_001);

                await expect(promise).rejects.toThrow('timed out');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('restart behavior', () => {
        it('should fire onRestart callback after restart', () => {
            vi.useFakeTimers();
            try {
                const cb = vi.fn();
                client.onRestart(cb);
                client.start();

                // Simulate process exit
                mock.mockProcess.emit('exit', 1);

                // Advance past restart delay
                vi.advanceTimersByTime(1001);

                expect(cb).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('should reject pending requests when process exits unexpectedly', async () => {
            client.start();
            const promise = client.sendRequest({ getMetadata: {} });

            mock.mockProcess.emit('exit', 1);

            await expect(promise).rejects.toThrow('Process exited unexpectedly');
        });
    });
});
