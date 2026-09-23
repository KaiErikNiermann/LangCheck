import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import * as zlib from 'zlib';

import { GITHUB_REPO } from '../shared/links';

const BINARY_NAME = 'language-check-server';

interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface ReleaseInfo {
    tag_name: string;
    assets: ReleaseAsset[];
}

/** Resolves the platform-specific tar.gz archive asset name. */
export function getPlatformArchiveName(): string {
    const platform = os.platform();
    const arch = os.arch();

    let target: string;
    switch (platform) {
        case 'linux':
            target = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
            break;
        case 'darwin':
            target = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
            break;
        case 'win32':
            target = 'x86_64-pc-windows-msvc';
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}/${arch}`);
    }

    return `language-check-${target}.tar.gz`;
}

/** The server binary name inside the archive for the current platform. */
function serverBinaryName(): string {
    return os.platform() === 'win32' ? `${BINARY_NAME}.exe` : BINARY_NAME;
}

/** Check if the core binary already exists at the given path. */
export function binaryExists(binDir: string): boolean {
    return fs.existsSync(path.join(binDir, serverBinaryName()));
}

/** Download the core binary for the current platform from GitHub Releases.
 *  Pass `extensionVersion` to warn when the extension is newer than the latest release. */
export async function downloadBinary(
    binDir: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    extensionVersion?: string,
): Promise<string> {
    progress.report({ message: '(1/3) Fetching latest release info…' });

    const release = await fetchLatestRelease();

    // Warn if the extension version is ahead of the latest release binary.
    // This typically happens when installing a locally-built extension before
    // release binaries have been published.
    if (extensionVersion) {
        const releaseVersion = release.tag_name.replace(/^v/, '');
        if (extensionVersion !== releaseVersion && isNewerVersion(extensionVersion, releaseVersion)) {
            vscode.window.showWarningMessage(
                `Extension v${extensionVersion} is newer than the latest release binary (v${releaseVersion}). ` +
                `There may be version incompatibilities. The release binaries may not have synced yet.`,
            );
        }
    }

    const archiveName = getPlatformArchiveName();

    const archiveAsset = release.assets.find(a => a.name === archiveName);

    if (!archiveAsset) {
        throw new Error(
            `No release archive found for your platform (${archiveName}).\n` +
            `Available assets: ${release.assets.map(a => a.name).join(', ')}\n\n` +
            `You can download manually from: https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}`
        );
    }

    // Ensure bin directory exists
    fs.mkdirSync(binDir, { recursive: true });

    const destPath = path.join(binDir, serverBinaryName());
    const archivePath = path.join(binDir, archiveName);

    progress.report({ message: '(2/3) Downloading…' });

    // Download archive
    await downloadFile(
        archiveAsset.browser_download_url,
        archivePath,
        (pct) => {
            progress.report({ message: `(2/3) Downloading… ${pct}%` });
        },
        {
            onRetry: (n, reason) => {
                // Said out loud. A retry that looks like a stall is the same
                // to the user as a stall.
                progress.report({ message: `(2/3) Retrying after ${reason} (attempt ${n + 1})…` });
            },
        },
    );

    // Verify the archive against the checksum the release published.
    //
    // A size check catches a download that stopped early; this catches one
    // that arrived complete and wrong. Skipped when the release has no
    // checksums asset, which is every release before this was added -- a
    // missing file is an older release, not a compromised one, and refusing
    // to install would strand anyone pinned to one.
    const checksumsAsset = release.assets.find(a => a.name === CHECKSUMS_ASSET);
    if (checksumsAsset) {
        progress.report({ message: '(3/3) Verifying…' });
        const expected = await expectedChecksum(
            checksumsAsset.browser_download_url,
            archiveName,
            binDir,
        );
        if (expected) {
            const actual = await computeSha256(archivePath);
            if (actual !== expected) {
                fs.unlinkSync(archivePath);
                throw new Error(
                    `The downloaded archive does not match the checksum published for `
                    + `${release.tag_name}. Expected ${expected}, got ${actual}. `
                    + `Nothing was installed.`,
                );
            }
        }
    }

    // Extract the server binary from the tar.gz archive
    progress.report({ message: '(3/3) Extracting binary…' });
    const binaryName = serverBinaryName();
    const extracted = await extractFileFromTarGz(archivePath, binaryName);

    if (!extracted) {
        fs.unlinkSync(archivePath);
        throw new Error(
            `Archive does not contain ${binaryName}.\n` +
            `Download manually from: https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}`
        );
    }

    // Write the extracted binary
    const tempPath = `${destPath}.tmp`;
    fs.writeFileSync(tempPath, extracted);
    fs.renameSync(tempPath, destPath);

    // Make executable on Unix
    if (os.platform() !== 'win32') {
        fs.chmodSync(destPath, 0o755);
    }

    // Clean up the downloaded archive
    fs.unlinkSync(archivePath);

    progress.report({ message: 'Installed successfully' });
    return destPath;
}

/** The release asset listing one SHA-256 per archive. */
const CHECKSUMS_ASSET = 'checksums.txt';

/**
 * The checksum `archiveName` should have, from the release's checksums file.
 *
 * Returns undefined when the file cannot be read or does not mention the
 * archive, which is treated as "no checksum to check against" rather than as a
 * failure: the alternative is refusing to install over a network hiccup
 * fetching a file that is only a cross-check.
 */
async function expectedChecksum(
    url: string,
    archiveName: string,
    binDir: string,
): Promise<string | undefined> {
    const localPath = path.join(binDir, CHECKSUMS_ASSET);
    try {
        await downloadFile(url, localPath, undefined, { attempts: 2 });
        const listing = fs.readFileSync(localPath, 'utf8');
        fs.unlinkSync(localPath);
        // `sha256sum` format: the digest, whitespace, then the file name.
        for (const line of listing.split(/\r?\n/)) {
            const [digest, name] = line.trim().split(/\s+/);
            if (name === archiveName && digest) return digest.toLowerCase();
        }
        return undefined;
    } catch {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        return undefined;
    }
}

/** Fetch the latest release info from GitHub. */
async function fetchLatestRelease(): Promise<ReleaseInfo> {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'language-check-vscode' } }, (res) => {
            if (res.statusCode === 302 && res.headers.location) {
                https.get(res.headers.location, { headers: { 'User-Agent': 'language-check-vscode' } }, (redirectRes) => {
                    collectJson(redirectRes, resolve, reject);
                }).on('error', reject);
                return;
            }
            collectJson(res, resolve, reject);
        }).on('error', reject);
    });
}

function collectJson<T>(res: NodeJS.ReadableStream & { statusCode?: number | undefined }, resolve: (val: T) => void, reject: (err: Error) => void): void {
    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        // Drain the stream so it doesn't hang, then reject
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            try {
                const json = JSON.parse(body);
                reject(new Error(`GitHub API error (${res.statusCode}): ${json.message ?? body}`));
            } catch {
                reject(new Error(`GitHub API error (${res.statusCode}): ${body}`));
            }
        });
        res.on('error', reject);
        return;
    }
    const chunks: Buffer[] = [];
    res.on('data', (d: Buffer) => chunks.push(d));
    res.on('end', () => {
        try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            if (!parsed.assets) {
                reject(new Error(
                    `Unexpected GitHub API response (no assets field). ` +
                    `This may mean no release exists yet. Response: ${JSON.stringify(parsed).slice(0, 200)}`
                ));
                return;
            }
            resolve(parsed);
        } catch (e) {
            reject(new Error(`Failed to parse release JSON: ${e}`));
        }
    });
    res.on('error', reject);
}

/** Download a file from a URL to a local path. */
/** How many times a download is attempted before the user is told it failed. */
const DOWNLOAD_ATTEMPTS = 3;

/** How long a connection may stall before the attempt is abandoned. */
const STALL_TIMEOUT_MS = 30_000;

/** The `https.get` seam, so the failure paths can be tested without a network. */
export type HttpGet = typeof https.get;

export interface DownloadOptions {
    attempts?: number;
    timeoutMs?: number;
    get?: HttpGet;
    /** Called between attempts, so a caller can say what is happening. */
    onRetry?: (attempt: number, reason: string) => void;
}

/**
 * Download `url` to `destPath`, or throw saying why.
 *
 * The core binary is the whole extension, so a download that half-succeeds is
 * the worst outcome available: nothing works and nothing says why. Three
 * things make that impossible here.
 *
 * A short read is a failure. The previous version compared the byte count to
 * nothing at all -- it read `content-length` only to draw the progress bar --
 * and resolved on the write stream's `finish`, which a truncated response
 * reaches just as happily as a complete one. A connection dropped at 90%
 * produced a partial archive reported as a successful download.
 *
 * A stalled connection is a failure. `https.get` has no timeout of its own, so
 * a server that accepted the connection and then stopped sending left the
 * progress notification on screen indefinitely.
 *
 * And a transient failure is retried before the user hears about it, because
 * the common cause is a network blip rather than anything they can act on.
 */
export function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (pct: number) => void,
    options: DownloadOptions = {},
): Promise<void> {
    const attempts = options.attempts ?? DOWNLOAD_ATTEMPTS;
    const timeoutMs = options.timeoutMs ?? STALL_TIMEOUT_MS;
    const get = options.get ?? https.get;

    const attempt = (): Promise<void> => new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        let settled = false;

        // Every failure path goes through here, so a partial file is never
        // left behind to be mistaken for an installed binary.
        const fail = (reason: string) => {
            if (settled) return;
            settled = true;
            file.destroy();
            fs.unlink(destPath, () => reject(new Error(reason)));
        };

        file.on('error', (err) => fail(`could not write ${destPath}: ${err.message}`));

        const doGet = (getUrl: string, redirectsLeft: number) => {
            const request = get(
                getUrl,
                { headers: { 'User-Agent': 'language-check-vscode' } },
                (res) => {
                    if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                        if (redirectsLeft === 0) {
                            fail('too many redirects');
                            return;
                        }
                        res.resume();
                        doGet(res.headers.location, redirectsLeft - 1);
                        return;
                    }
                    if (res.statusCode !== undefined && res.statusCode >= 400) {
                        res.resume();
                        fail(`the server answered ${res.statusCode}`);
                        return;
                    }

                    const total = parseInt(res.headers['content-length'] ?? '0', 10);
                    let downloaded = 0;

                    res.on('data', (chunk: Buffer) => {
                        downloaded += chunk.length;
                        if (total > 0 && onProgress) {
                            onProgress(Math.round((downloaded / total) * 100));
                        }
                    });
                    // A response cut off mid-stream still ends the pipe, so
                    // without this the write stream reaches `finish` and the
                    // partial file looks like a complete one.
                    res.on('aborted', () => fail('the connection closed before the download finished'));
                    res.on('error', (err) => fail(`the download failed: ${err.message}`));

                    res.pipe(file);
                    file.on('finish', () => {
                        if (settled) return;
                        // The size the server promised against the size that
                        // arrived. This is what makes a truncated download an
                        // error rather than a successful one.
                        if (total > 0 && downloaded !== total) {
                            fail(
                                `the download stopped early: got ${downloaded} bytes of ${total}`,
                            );
                            return;
                        }
                        settled = true;
                        file.close();
                        resolve();
                    });
                },
            );

            request.setTimeout(timeoutMs, () => {
                request.destroy();
                fail(`no data for ${Math.round(timeoutMs / 1000)}s`);
            });
            request.on('error', (err) => fail(`the download failed: ${err.message}`));
        };

        doGet(url, 5);
    });

    const attemptWithRetries = async (): Promise<void> => {
        let lastReason = 'unknown';
        for (let n = 1; n <= attempts; n++) {
            try {
                await attempt();
                return;
            } catch (err) {
                lastReason = err instanceof Error ? err.message : String(err);
                if (n < attempts) {
                    options.onRetry?.(n, lastReason);
                    // Backed off a little, since the usual cause is a blip
                    // and retrying instantly tends to hit the same one.
                    await new Promise(r => setTimeout(r, 500 * n));
                }
            }
        }
        throw new Error(
            `Downloading the core binary failed after ${attempts} attempts: ${lastReason}`,
        );
    };

    return attemptWithRetries();
}

/**
 * Extract a single file from a .tar.gz archive by name.
 *
 * Uses Node's built-in zlib for gzip decompression and parses the tar
 * format directly — no external dependencies required.
 */
function extractFileFromTarGz(archivePath: string, fileName: string): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const gunzip = zlib.createGunzip();
        const input = fs.createReadStream(archivePath);

        input.pipe(gunzip);

        gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
        gunzip.on('end', () => {
            try {
                const tar = Buffer.concat(chunks);
                const result = extractFromTar(tar, fileName);
                resolve(result);
            } catch (e) {
                reject(e);
            }
        });
        gunzip.on('error', reject);
        input.on('error', reject);
    });
}

/**
 * Parse a tar buffer and extract a file by name.
 *
 * Tar format: 512-byte header blocks followed by file data (padded to 512).
 * We only need the name (offset 0, 100 bytes) and size (offset 124, 12 bytes).
 */
function extractFromTar(tar: Buffer, fileName: string): Buffer | null {
    const BLOCK = 512;
    let offset = 0;

    while (offset + BLOCK <= tar.length) {
        const header = tar.subarray(offset, offset + BLOCK);

        // End of archive: two consecutive zero blocks
        if (header.every(b => b === 0)) break;

        // Read name — may be prefixed with a path (e.g. "dist/language-check-server")
        const rawName = header.subarray(0, 100).toString('utf-8').replace(/\0/g, '');
        const name = path.posix.basename(rawName);

        // Read size (octal, 11 chars at offset 124)
        const sizeStr = header.subarray(124, 124 + 12).toString('utf-8').replace(/\0/g, '').trim();
        const size = parseInt(sizeStr, 8) || 0;

        const dataStart = offset + BLOCK;
        const dataEnd = dataStart + size;

        if (name === fileName && size > 0) {
            return tar.subarray(dataStart, dataEnd);
        }

        // Advance past header + data (rounded up to 512-byte boundary)
        offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    }

    return null;
}

/** Returns true if `a` is a newer semver than `b`. */
function isNewerVersion(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
        if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
    }
    return false;
}

/** Compute SHA-256 hash of a file. */
export function computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (d) => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
