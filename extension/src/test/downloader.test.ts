import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        platform: vi.fn(() => actual.platform()),
        arch: vi.fn(() => actual.arch()),
    };
});

// Import after mocking
import { EventEmitter } from 'events';

import { getPlatformArchiveName, binaryExists, downloadFile, computeSha256 } from '../downloader';
import type { HttpGet } from '../downloader';

describe('downloader', () => {
    describe('getPlatformArchiveName', () => {
        it('should return linux x86_64 archive name', () => {
            vi.mocked(os.platform).mockReturnValue('linux');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformArchiveName()).toBe('language-check-x86_64-unknown-linux-gnu.tar.gz');
        });

        it('should return linux aarch64 archive name', () => {
            vi.mocked(os.platform).mockReturnValue('linux');
            vi.mocked(os.arch).mockReturnValue('arm64');
            expect(getPlatformArchiveName()).toBe('language-check-aarch64-unknown-linux-gnu.tar.gz');
        });

        it('should return macOS arm64 archive name', () => {
            vi.mocked(os.platform).mockReturnValue('darwin');
            vi.mocked(os.arch).mockReturnValue('arm64');
            expect(getPlatformArchiveName()).toBe('language-check-aarch64-apple-darwin.tar.gz');
        });

        it('should return macOS x86_64 archive name', () => {
            vi.mocked(os.platform).mockReturnValue('darwin');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformArchiveName()).toBe('language-check-x86_64-apple-darwin.tar.gz');
        });

        it('should return windows archive name', () => {
            vi.mocked(os.platform).mockReturnValue('win32');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformArchiveName()).toBe('language-check-x86_64-pc-windows-msvc.tar.gz');
        });

        it('should throw for unsupported platform', () => {
            vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(() => getPlatformArchiveName()).toThrow('Unsupported platform');
        });
    });

    describe('binaryExists', () => {
        let tmpDir: string;

        beforeEach(() => {
            vi.restoreAllMocks();
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-test-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should return false when binary does not exist', () => {
            expect(binaryExists(tmpDir)).toBe(false);
        });

        it('should return true when binary exists', () => {
            const ext = process.platform === 'win32' ? '.exe' : '';
            const binPath = path.join(tmpDir, `language-check-server${ext}`);
            fs.writeFileSync(binPath, 'fake');
            expect(binaryExists(tmpDir)).toBe(true);
        });
    });
});

describe('downloadFile', () => {
    /**
     * A fake `https.get` driven by a script of chunks.
     *
     * The failures that matter here -- a connection dropped mid-stream, a
     * server that stops sending, a body shorter than its own content-length --
     * cannot be produced against a real endpoint on demand, and they are
     * exactly the ones that used to be reported as success.
     */
    function fakeGet(plan: {
        contentLength?: number;
        chunks: string[];
        then?: 'end' | 'abort' | 'silence';
        statusCode?: number;
    }) {
        return ((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
            const res = new EventEmitter() as EventEmitter & {
                statusCode?: number;
                headers: Record<string, string>;
                pipe: (dest: NodeJS.WritableStream) => void;
                resume: () => void;
            };
            res.statusCode = plan.statusCode ?? 200;
            res.headers = plan.contentLength === undefined
                ? {}
                : { 'content-length': String(plan.contentLength) };
            res.resume = () => { /* drained */ };
            res.pipe = (dest: NodeJS.WritableStream) => {
                setImmediate(() => {
                    for (const chunk of plan.chunks) {
                        res.emit('data', Buffer.from(chunk));
                        dest.write(chunk);
                    }
                    if (plan.then === 'abort') {
                        dest.end();
                        res.emit('aborted');
                    } else if (plan.then !== 'silence') {
                        dest.end();
                    }
                });
            };

            const request = new EventEmitter() as EventEmitter & {
                setTimeout: (ms: number, cb: () => void) => void;
                destroy: () => void;
            };
            request.setTimeout = (ms, onTimeout) => {
                if (plan.then === 'silence') setTimeout(onTimeout, ms);
            };
            request.destroy = () => { /* nothing to tear down */ };
            setImmediate(() => cb(res));
            return request;
        }) as unknown as HttpGet;
    }

    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-download-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes the file when the whole body arrives', async () => {
        const dest = path.join(dir, 'archive');
        await downloadFile('https://example.org/a', dest, undefined, {
            get: fakeGet({ contentLength: 6, chunks: ['abc', 'def'] }),
            attempts: 1,
        });
        expect(fs.readFileSync(dest, 'utf8')).toBe('abcdef');
    });

    it('rejects a body shorter than its content-length', async () => {
        // The reported failure: a connection dropped at 90% produced a partial
        // archive that the old code resolved as a successful download.
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ contentLength: 10, chunks: ['abc'] }),
                attempts: 1,
            }),
        ).rejects.toThrow(/stopped early: got 3 bytes of 10/);
    });

    it('leaves no partial file behind', async () => {
        // A partial file at the destination is worse than none: it is what
        // `binaryExists` looks at, so the next start would find it and try to
        // run it.
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ contentLength: 10, chunks: ['abc'] }),
                attempts: 1,
            }),
        ).rejects.toThrow();
        expect(fs.existsSync(dest)).toBe(false);
    });

    it('rejects a connection dropped mid-stream', async () => {
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ contentLength: 99, chunks: ['abc'], then: 'abort' }),
                attempts: 1,
            }),
        ).rejects.toThrow(/closed before the download finished|stopped early/);
    });

    it('rejects a server that stops sending', async () => {
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ contentLength: 99, chunks: ['abc'], then: 'silence' }),
                attempts: 1,
                timeoutMs: 30,
            }),
        ).rejects.toThrow(/no data for/);
    });

    it('rejects an error status instead of saving the error page', async () => {
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ statusCode: 404, chunks: ['not found'] }),
                attempts: 1,
            }),
        ).rejects.toThrow(/answered 404/);
    });

    it('retries a transient failure and succeeds', async () => {
        // The common case is a blip, which the user should never hear about.
        const dest = path.join(dir, 'archive');
        let call = 0;
        const flaky = ((url: string, opts: unknown, cb: (res: unknown) => void) => {
            call += 1;
            const plan = call === 1
                ? { contentLength: 10, chunks: ['abc'] }
                : { contentLength: 6, chunks: ['abc', 'def'] };
            return (fakeGet(plan) as unknown as (u: string, o: unknown, c: (r: unknown) => void) => unknown)(url, opts, cb);
        }) as unknown as HttpGet;

        const retries: string[] = [];
        await downloadFile('https://example.org/a', dest, undefined, {
            get: flaky,
            attempts: 3,
            onRetry: (_n, reason) => retries.push(reason),
        });

        expect(fs.readFileSync(dest, 'utf8')).toBe('abcdef');
        expect(retries).toHaveLength(1);
    });

    it('gives up after the last attempt and says how many it made', async () => {
        const dest = path.join(dir, 'archive');
        await expect(
            downloadFile('https://example.org/a', dest, undefined, {
                get: fakeGet({ contentLength: 10, chunks: ['abc'] }),
                attempts: 2,
            }),
        ).rejects.toThrow(/failed after 2 attempts/);
    });
});

describe('computeSha256', () => {
    it('matches what sha256sum would print', async () => {
        // The release publishes `sha256sum` output, so the two have to agree
        // about the same bytes or every verification fails on correct files.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-sha-'));
        const file = path.join(dir, 'archive');
        fs.writeFileSync(file, 'abc');
        try {
            // SHA-256 of "abc", a published constant.
            await expect(computeSha256(file)).resolves.toBe(
                'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
