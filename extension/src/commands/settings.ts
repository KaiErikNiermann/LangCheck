/** Commands that change settings or the config file. */
import * as path from 'path';
import * as vscode from 'vscode';

import {
    addLatexListEntry,
    engineEnabled,
    setEngineEnabled,
    setSpellLanguage,
    spellLanguageOf,
    type LatexList,
} from '../config/edits';
import {
    readTextOrEmpty,
    resolveConfigForEdit,
    showConfigUpdateError,
    workspaceFolderOrWarn,
    writeConfigText,
} from '../config/file';
import { getSetting, updateSetting } from '../config/settings';
import type { App } from '../services';
import { COMMANDS, type CommandHandlers } from './ids';

export function settingsCommands(app: App) {
    const { statusBars, configState, inlayHintEmitter, inlayHintSwitch, reloader } = app;

    /**
     * Add a name to one of the `languages.latex` lists, then refresh the hints.
     *
     * Behind the three LaTeX inlay-hint actions. The set is updated here as
     * well as in the file, so the hint goes before the config watcher has
     * re-read anything.
     */
    const appendToLatexList = async (list: LatexList, name: string, message: string, userSet: Set<string>) => {
        const workspaceFolder = workspaceFolderOrWarn();
        if (!workspaceFolder) return;

        const targetUri = await resolveConfigForEdit(workspaceFolder);
        try {
            await writeConfigText(targetUri, addLatexListEntry(await readTextOrEmpty(targetUri), list, name));
            vscode.window.showInformationMessage(message);
            userSet.add(name);
            inlayHintEmitter.fire();
        } catch (err) {
            showConfigUpdateError(err);
        }
    };

    return {
        [COMMANDS.toggleInlayHints]: () => {
            inlayHintSwitch.enabled = !inlayHintSwitch.enabled;
            inlayHintEmitter.fire();
            vscode.window.showInformationMessage(inlayHintSwitch.enabled
                ? vscode.l10n.t('Language Check inlay hints enabled')
                : vscode.l10n.t('Language Check inlay hints disabled'));
        },
        [COMMANDS.toggleCheckTrigger]: async () => {
            const current = getSetting('check.trigger');
            const next = current === 'onChange' ? 'onSave' : 'onChange';
            await updateSetting('check.trigger', next, vscode.ConfigurationTarget.Workspace);
            const label = next === 'onSave'
                ? vscode.l10n.t('Switched to check on save')
                : vscode.l10n.t('Switched to check on change');
            vscode.window.showInformationMessage(label);
        },
        [COMMANDS.managePlugins]: async () => {
            // `?? []` as well as the manifest default: a `null` written into
            // settings.json by hand comes back as null, not as the default.
            const plugins = getSetting('plugins') ?? [];

            if (plugins.length === 0) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('No plugins configured. Add plugins in settings (languageCheck.plugins).')
                );
                return;
            }

            const items = plugins.map((p, i) => {
                const name = p.name ?? path.basename(p.path, '.wasm');
                const enabled = p.enabled !== false;
                return {
                    label: name,
                    description: enabled
                        ? vscode.l10n.t('{0} (enabled)', p.path)
                        : vscode.l10n.t('{0} (disabled)', p.path),
                    picked: enabled,
                    index: i,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: vscode.l10n.t('Select plugins to enable/disable'),
            });

            if (!selected) return;

            const selectedIndices = new Set(selected.map(s => s.index));
            const updated = plugins.map((p, i) => ({ ...p, enabled: selectedIndices.has(i) }));
            await updateSetting('plugins', updated, vscode.ConfigurationTarget.Workspace);

            for (const item of items) {
                const nowEnabled = selectedIndices.has(item.index);
                const wasEnabled = plugins[item.index]?.enabled !== false;
                if (nowEnabled !== wasEnabled) {
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Plugin "{0}" {1}', item.label, nowEnabled ? 'enabled' : 'disabled')
                    );
                }
            }
        },
        [COMMANDS.selectLanguage]: async () => {
            const languages = [
                { label: 'en-US', description: vscode.l10n.t('English (US)') },
                { label: 'en-GB', description: vscode.l10n.t('English (UK)') },
                { label: 'de-DE', description: vscode.l10n.t('German (Germany)') },
                { label: 'de-AT', description: vscode.l10n.t('German (Austria)') },
                { label: 'fr', description: vscode.l10n.t('French') },
                { label: 'es', description: vscode.l10n.t('Spanish') },
                { label: 'pt-BR', description: vscode.l10n.t('Portuguese (Brazil)') },
                { label: 'pt-PT', description: vscode.l10n.t('Portuguese (Portugal)') },
                { label: 'it', description: vscode.l10n.t('Italian') },
                { label: 'nl', description: vscode.l10n.t('Dutch') },
                { label: 'pl', description: vscode.l10n.t('Polish') },
                { label: 'ru', description: vscode.l10n.t('Russian') },
                { label: 'uk', description: vscode.l10n.t('Ukrainian') },
                { label: 'ja', description: vscode.l10n.t('Japanese') },
                { label: 'zh', description: vscode.l10n.t('Chinese') },
                { label: 'ko', description: vscode.l10n.t('Korean') },
                { label: 'ar', description: vscode.l10n.t('Arabic') },
                { label: 'sv', description: vscode.l10n.t('Swedish') },
                { label: 'da', description: vscode.l10n.t('Danish') },
                { label: 'fi', description: vscode.l10n.t('Finnish') },
                { label: 'cs', description: vscode.l10n.t('Czech') },
                { label: 'ro', description: vscode.l10n.t('Romanian') },
            ];
            const selected = await vscode.window.showQuickPick(languages, {
                placeHolder: vscode.l10n.t('Select spell-check language')
            });
            if (!selected) return;

            const workspaceFolder = workspaceFolderOrWarn();
            if (!workspaceFolder) return;

            const targetUri = await resolveConfigForEdit(workspaceFolder);
            try {
                const content = setSpellLanguage(await readTextOrEmpty(targetUri), selected.label);
                await writeConfigText(targetUri, content);
                statusBars.setLanguage(selected.label);
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Spell-check language set to "{0}". Reloading...', selected.label)
                );
                await reloader.reinitializeAndRecheck();
            } catch (err) {
                showConfigUpdateError(err);
            }
        },
        [COMMANDS.manageEngines]: async () => {
            const workspaceFolder = workspaceFolderOrWarn();
            if (!workspaceFolder) return;

            const targetUri = await resolveConfigForEdit(workspaceFolder);
            let content = await readTextOrEmpty(targetUri);

            // Determine current language to show language-support hints
            const spellLang = spellLanguageOf(content);
            const isEnglish = spellLang.startsWith('en');

            // Engine definitions: key, label, description, language constraint
            const engines: { key: string; label: string; desc: string; englishOnly: boolean }[] = [
                { key: 'harper', label: 'Harper', desc: vscode.l10n.t('Fast, local grammar/spelling'), englishOnly: true },
                { key: 'languagetool', label: 'LanguageTool', desc: vscode.l10n.t('Server-based deep analysis'), englishOnly: false },
                { key: 'vale', label: 'Vale', desc: vscode.l10n.t('Style linting with plugins'), englishOnly: false },
                { key: 'proselint', label: 'Proselint', desc: vscode.l10n.t('English prose best practices'), englishOnly: true },
            ];

            // Build multi-select items with current state
            // Supports both bool shorthand (`harper: true`) and nested (`harper:\n  enabled: true`)
            const items: (vscode.QuickPickItem & { engineKey: string })[] = engines
                .map(e => {
                    // harper defaults to true, others to false
                    const isOn = engineEnabled(content, e.key, e.key === 'harper');
                    const langNote = e.englishOnly && !isEnglish
                        ? ` $(warning) ${vscode.l10n.t('English only')}`
                        : '';
                    return {
                        label: e.label,
                        description: `${e.desc}${langNote}`,
                        picked: isOn,
                        engineKey: e.key,
                    };
                });

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: vscode.l10n.t('Select engines to enable (language: {0})', spellLang),
            });
            if (!selected) return;

            const enabledKeys = new Set(selected.map(s => s.engineKey));

            try {
                for (const e of engines) {
                    content = setEngineEnabled(content, e.key, enabledKeys.has(e.key));
                }

                await writeConfigText(targetUri, content);
                const names = selected.map(s => s.label).join(', ');
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Engines updated: {0}. Reloading...', names)
                );
                await reloader.reinitializeAndRecheck();
            } catch (err) {
                showConfigUpdateError(err);
            }
        },
        [COMMANDS.skipLatexEnv]: (envName: string) =>
            appendToLatexList('skip_environments', envName,
                vscode.l10n.t('Added "{0}" to skip list. Rechecking...', envName), configState.skipEnvironments),
        [COMMANDS.hideLatexEnvHint]: (envName: string) =>
            appendToLatexList('prose_environments', envName,
                vscode.l10n.t('Hint hidden for "{0}". Checking continues.', envName), configState.proseEnvironments),
        [COMMANDS.skipLatexCommand]: (cmdName: string) =>
            appendToLatexList('skip_commands', cmdName,
                vscode.l10n.t('Added "{0}" to skip_commands. Rechecking...', cmdName), configState.skipCommands),
    } satisfies CommandHandlers;
}
