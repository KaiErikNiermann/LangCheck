import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

const GITHUB_REPO = 'KaiErikNiermann/lang-check';
const BINARY_NAME = 'language-check-server';

interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface ReleaseInfo {
    tag_name: string;
    assets: ReleaseAsset[];
}

/** Resolves the platform-specific binary name for the current OS/arch. */
export function getPlatformBinaryName(): string {
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

    const ext = platform === 'win32' ? '.exe' : '';
    return `${BINARY_NAME}-${target}${ext}`;
}

/** Check if the core binary already exists at the given path. */
export function binaryExists(binDir: string): boolean {
    const ext = os.platform() === 'win32' ? '.exe' : '';
    return fs.existsSync(path.join(binDir, `${BINARY_NAME}${ext}`));
}

/** Download the core binary for the current platform from GitHub Releases. */
export async function downloadBinary(
    binDir: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<string> {
    progress.report({ message: 'Fetching latest release info...' });

    const release = await fetchLatestRelease();
    const assetName = getPlatformBinaryName();
    const checksumAssetName = `${assetName}.sha256`;

    const binaryAsset = release.assets.find(a => a.name === assetName);
    const checksumAsset = release.assets.find(a => a.name === checksumAssetName);

    if (!binaryAsset) {
        throw new Error(
            `No binary found for your platform (${assetName}).\n` +
            `Available assets: ${release.assets.map(a => a.name).join(', ')}\n\n` +
            `You can download manually from: https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}`
        );
    }

    // Ensure bin directory exists
    fs.mkdirSync(binDir, { recursive: true });

    const ext = os.platform() === 'win32' ? '.exe' : '';
    const destPath = path.join(binDir, `${BINARY_NAME}${ext}`);
    const tempPath = `${destPath}.tmp`;

    progress.report({ message: `Downloading ${assetName}...`, increment: 10 });

    // Download binary
    await downloadFile(binaryAsset.browser_download_url, tempPath, (pct) => {
        progress.report({ message: `Downloading... ${pct}%`, increment: 1 });
    });

    // Verify checksum if available
    if (checksumAsset) {
        progress.report({ message: 'Verifying checksum...' });
        const checksumFile = `${tempPath}.sha256`;
        await downloadFile(checksumAsset.browser_download_url, checksumFile);

        const expectedHash = fs.readFileSync(checksumFile, 'utf-8').trim().split(/\s+/)[0]!;
        const actualHash = await computeSha256(tempPath);

        fs.unlinkSync(checksumFile);

        if (expectedHash !== actualHash) {
            fs.unlinkSync(tempPath);
            throw new Error(
                `Checksum verification failed.\nExpected: ${expectedHash}\nActual:   ${actualHash}`
            );
        }
    }

    // Move temp to final destination
    fs.renameSync(tempPath, destPath);

    // Make executable on Unix
    if (os.platform() !== 'win32') {
        fs.chmodSync(destPath, 0o755);
    }

    progress.report({ message: 'Done!', increment: 100 });
    return destPath;
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
    const chunks: Buffer[] = [];
    res.on('data', (d: Buffer) => chunks.push(d));
    res.on('end', () => {
        try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
            reject(new Error(`Failed to parse release JSON: ${e}`));
        }
    });
    res.on('error', reject);
}

/** Download a file from a URL to a local path. */
function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (pct: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const doGet = (getUrl: string) => {
            https.get(getUrl, { headers: { 'User-Agent': 'language-check-vscode' } }, (res) => {
                if (res.statusCode === 302 && res.headers.location) {
                    doGet(res.headers.location);
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

                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        };
        doGet(url);
    });
}

/** Compute SHA-256 hash of a file. */
function computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (d) => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
