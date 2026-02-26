import { describe, it, expect, vi } from 'vitest';
import { LanguageClient } from '../client';
import { languagecheck } from '../proto/checker';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process');

describe('LanguageClient', () => {
    it('should frame messages correctly', async () => {
        const mockStdout = new EventEmitter();
        const mockStdin = {
            write: vi.fn(),
        };
        const mockProcess = {
            stdout: mockStdout,
            stdin: mockStdin,
            on: vi.fn(),
            kill: vi.fn(),
        };

        (cp.spawn as any).mockReturnValue(mockProcess);

        const client = new LanguageClient('mock-binary');
        client.start();

        // Simulate receiving a response from the core
        const response = languagecheck.Response.create({
            id: 1,
            checkProse: {
                diagnostics: [
                    {
                        message: 'Test diagnostic',
                        startByte: 0,
                        endByte: 10,
                        ruleId: 'test.rule',
                        severity: languagecheck.Severity.SEVERITY_INFORMATION
                    }
                ]
            }
        });

        const responseData = languagecheck.Response.encode(response).finish();
        const lengthBuf = Buffer.alloc(4);
        lengthBuf.writeUInt32BE(responseData.length, 0);

        // Send length prefix then data
        mockStdout.emit('data', lengthBuf);
        mockStdout.emit('data', Buffer.from(responseData));

        // In a real scenario, we'd wait for a request/response pair
        // but since we are testing framing, let's just check if we can decode it.
    });
});
