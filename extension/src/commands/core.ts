/** The core process and its binary. */
import * as vscode from 'vscode';

import { downloadFailedMessage, downloadWithProgress, onDownloadFailedChoice } from '../core/binary';
import { restartLanguageToolDocker } from '../core/languagetool';
import { updateSetting, type SettingValue } from '../config/settings';
import type { App } from '../services';
import { COMMANDS, type CommandHandlers } from './ids';

export function coreCommands(app: App) {
    const { context, log, isDev, inspectorLog, core, checker, packs } = app;

    return {
        [COMMANDS.downloadBinary]: async () => {
            const result = await downloadWithProgress(context);
            if (result.ok) {
                core.restart();
            } else {
                onDownloadFailedChoice(await downloadFailedMessage(result.error));
            }
        },
        [COMMANDS.restartLanguageServer]: () => {
            log.info('Restarting language server');
            inspectorLog.push('info', 'restartServer', 'Restarting language server');
            core.restart();
            vscode.window.showInformationMessage(vscode.l10n.t('Language Check server restarted'));
        },
        [COMMANDS.restartLTDocker]: () =>
            restartLanguageToolDocker(document => checker.check(document)),
        [COMMANDS.toggleTrace]: () => {
            const enabled = core.traceLogger.toggle();
            vscode.window.showInformationMessage(
                vscode.l10n.t('Protobuf trace {0}', enabled ? vscode.l10n.t('enabled') : vscode.l10n.t('disabled'))
            );
        },
        [COMMANDS.showTrace]: () => {
            core.traceLogger.show();
        },
        [COMMANDS.switchCore]: async () => {
            const channels: { label: string; description: string; channel: SettingValue<'core.channel'> }[] = [
                { label: vscode.l10n.t('Stable'), description: vscode.l10n.t('Production release'), channel: 'stable' },
                { label: vscode.l10n.t('Canary'), description: vscode.l10n.t('Pre-release with latest features'), channel: 'canary' },
                { label: vscode.l10n.t('Dev'), description: vscode.l10n.t('Development build (debug symbols)'), channel: 'dev' },
            ];
            // Only offered on a development host, where rust-core/target/debug exists.
            if (isDev) {
                channels.push({
                    label: vscode.l10n.t('Debug'),
                    description: vscode.l10n.t('Local cargo debug build'),
                    channel: 'debug',
                });
            }
            const selected = await vscode.window.showQuickPick(channels, {
                placeHolder: vscode.l10n.t('Select core binary channel'),
            });
            if (!selected) return;

            await updateSetting('core.channel', selected.channel, vscode.ConfigurationTarget.Global);

            core.restart(selected.channel);

            vscode.window.showInformationMessage(
                vscode.l10n.t('Switched to {0} core', selected.label)
            );
        },
        [COMMANDS.installPack]: async (language: string) => {
            await packs.install(language);
        },
    } satisfies CommandHandlers;
}
