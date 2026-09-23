/**
 * The local LanguageTool server the repository's docker-compose.yml runs.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';

/** Check if a docker-compose.yml exists in the workspace root. */
export function hasDockerCompose(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return false;
    return fs.existsSync(path.join(folders[0]!.uri.fsPath, 'docker-compose.yml'));
}

async function pollLTReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ok = await new Promise<boolean>(resolve => {
            const req = http.get('http://localhost:8010/v2/languages', { timeout: 2000 }, (res) => {
                resolve(res.statusCode === 200);
                res.resume();
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (ok) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

/**
 * Restart the LanguageTool container and wait for it to answer, twice at most.
 *
 * `recheck` is run on the active document once it is up, so the engine
 * health the editor shows reflects the restarted server.
 */
export async function restartLanguageToolDocker(recheck: (document: vscode.TextDocument) => unknown): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder open'));
        return;
    }
    const rootPath = workspaceFolders[0]!.uri.fsPath;
    const composePath = path.join(rootPath, 'docker-compose.yml');
    if (!fs.existsSync(composePath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('No docker-compose.yml found in workspace root'));
        return;
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Restarting LanguageTool Docker…', cancellable: false },
        async (progress) => {
            const MAX_ATTEMPTS = 2;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                progress.report({ message: `Attempt ${attempt}/${MAX_ATTEMPTS}: stopping…` });
                try {
                    execSync('docker compose down', { cwd: rootPath, timeout: 30_000, stdio: 'pipe' });
                } catch { /* ignore stop errors */ }

                progress.report({ message: `Attempt ${attempt}/${MAX_ATTEMPTS}: starting…` });
                try {
                    execSync('docker compose up -d', { cwd: rootPath, timeout: 30_000, stdio: 'pipe' });
                } catch (e) {
                    if (attempt === MAX_ATTEMPTS) {
                        vscode.window.showErrorMessage(`Failed to start LanguageTool Docker: ${e}`);
                        return;
                    }
                    continue;
                }

                // Poll for readiness
                progress.report({ message: `Waiting for LanguageTool to be ready…` });
                const ready = await pollLTReady(15_000);
                if (ready) {
                    vscode.window.showInformationMessage(vscode.l10n.t('LanguageTool Docker restarted successfully'));
                    // Re-check active document to refresh health
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        recheck(editor.document);
                    }
                    return;
                }
                if (attempt === MAX_ATTEMPTS) {
                    vscode.window.showErrorMessage(vscode.l10n.t('LanguageTool Docker started but not responding after 15s'));
                }
            }
        },
    );
}
