import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { engineEnabled } from '../config/edits';
import { readFirstConfig } from '../config/file';
import type { InspectorEngineInfo } from '../ui/webviews/protocol';
import { ENGINES } from './engines';

/** Detect engine binaries and config files, for the Inspector's engine table. */
export async function detectEngineInfo(): Promise<InspectorEngineInfo[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];

    // Read .languagecheck config to determine enabled state
    const found = folder ? await readFirstConfig(folder) : undefined;
    const configContent = found?.text ?? '';
    const configFilePath = found?.uri.fsPath ?? '';

    const isEnabled = (key: string, defaultVal: boolean) => engineEnabled(configContent, key, defaultVal);

    /** Check if a binary exists in PATH. */
    function binaryInPath(name: string): boolean {
        try {
            execSync(`command -v ${name}`, { stdio: 'pipe' });
            return true;
        } catch { return false; }
    }

    /** Find an engine-specific config file. */
    function findConfig(candidates: readonly string[]): string {
        if (!folder) return '';
        for (const name of candidates) {
            const p = path.join(folder.uri.fsPath, name);
            if (fs.existsSync(p)) return p;
        }
        return '';
    }

    return ENGINES.map(engine => ({
        name: engine.name,
        enabled: isEnabled(engine.name, engine.enabledByDefault),
        type: engine.type,
        binaryDetected: engine.binary === undefined || binaryInPath(engine.binary),
        configPath: engine.configFiles === undefined
            ? (configFilePath ? `${configFilePath} (engines.${engine.name})` : '')
            : findConfig(engine.configFiles),
    }));
}
