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
import { getPlatformBinaryName, binaryExists } from '../downloader';

describe('downloader', () => {
    describe('getPlatformBinaryName', () => {
        it('should return linux x86_64 binary name', () => {
            vi.mocked(os.platform).mockReturnValue('linux');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformBinaryName()).toBe('language-check-server-x86_64-unknown-linux-gnu');
        });

        it('should return linux aarch64 binary name', () => {
            vi.mocked(os.platform).mockReturnValue('linux');
            vi.mocked(os.arch).mockReturnValue('arm64');
            expect(getPlatformBinaryName()).toBe('language-check-server-aarch64-unknown-linux-gnu');
        });

        it('should return macOS arm64 binary name', () => {
            vi.mocked(os.platform).mockReturnValue('darwin');
            vi.mocked(os.arch).mockReturnValue('arm64');
            expect(getPlatformBinaryName()).toBe('language-check-server-aarch64-apple-darwin');
        });

        it('should return macOS x86_64 binary name', () => {
            vi.mocked(os.platform).mockReturnValue('darwin');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformBinaryName()).toBe('language-check-server-x86_64-apple-darwin');
        });

        it('should return windows binary name with .exe', () => {
            vi.mocked(os.platform).mockReturnValue('win32');
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(getPlatformBinaryName()).toBe('language-check-server-x86_64-pc-windows-msvc.exe');
        });

        it('should throw for unsupported platform', () => {
            vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
            vi.mocked(os.arch).mockReturnValue('x64');
            expect(() => getPlatformBinaryName()).toThrow('Unsupported platform');
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
