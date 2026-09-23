/**
 * The extension's VS Code settings, typed from package.json.
 *
 * Keys and value types come from `generated/meta.ts`, so reading a setting the
 * manifest does not declare, or treating an enum as a free string, is a
 * compile error. The fallback passed to VS Code is the manifest's own default,
 * which is what a declared setting resolves to anyway.
 */
import * as vscode from 'vscode';

import { configs, type ConfigKeyTypeMap } from '../generated/meta';

const SECTION = 'languageCheck';

/** A setting key relative to `languageCheck.`, e.g. `check.trigger`. */
export type SettingKey = {
    [P in keyof ConfigKeyTypeMap]: P extends `${typeof SECTION}.${infer K}` ? K : never;
}[keyof ConfigKeyTypeMap];

export type SettingValue<K extends SettingKey> = ConfigKeyTypeMap[`${typeof SECTION}.${K}`];

const DEFAULTS: ReadonlyMap<string, unknown> = new Map(Object.values(configs).map(c => [c.key, c.default]));

export function getSetting<K extends SettingKey>(key: K): SettingValue<K> {
    const fallback = DEFAULTS.get(`${SECTION}.${key}`) as SettingValue<K>;
    return vscode.workspace.getConfiguration(SECTION).get<SettingValue<K>>(key, fallback);
}

export async function updateSetting<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    target: vscode.ConfigurationTarget,
): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update(key, value, target);
}

/** The full `languageCheck.*` id, for `ConfigurationChangeEvent.affectsConfiguration`. */
export function settingId(key: SettingKey): string {
    return `${SECTION}.${key}`;
}
