/**
 * Registering every command the extension has, from one table.
 */
import type * as vscode from 'vscode';

import type { App } from '../services';
import { checkCommands } from './check';
import { coreCommands } from './core';
import { diagnosticsCommands } from './diagnostics';
import { COMMANDS, registerCommand, type AllCommandHandlers, type CommandId } from './ids';
import { settingsCommands } from './settings';

/**
 * The order the commands are registered in: the order they were written in
 * when activate() registered each one itself. Registration order is not
 * behaviour, but keeping it keeps the activation-order snapshot exact.
 *
 * `configStatus` is not here: it is registered earlier in activation, before
 * the core is downloaded, so the end-to-end tests can read the config view
 * at any point.
 */
const REGISTRATION_ORDER = [
    COMMANDS.downloadBinary,
    COMMANDS.toggleInlayHints,
    COMMANDS.toggleCheckTrigger,
    COMMANDS.managePlugins,
    COMMANDS.restartLanguageServer,
    COMMANDS.restartLTDocker,
    COMMANDS.ignoreDiagnostic,
    COMMANDS.ignoreSelection,
    COMMANDS.fixAllSpellingInFile,
    COMMANDS.fixAllSpellingInWorkspace,
    COMMANDS.toggleTrace,
    COMMANDS.showTrace,
    COMMANDS.switchCore,
    COMMANDS.installPack,
    COMMANDS.addToDictionary,
    COMMANDS.deactivateRule,
    COMMANDS.applyFix,
    COMMANDS.selectLanguage,
    COMMANDS.manageEngines,
    COMMANDS.skipLatexEnv,
    COMMANDS.hideLatexEnvHint,
    COMMANDS.skipLatexCommand,
    COMMANDS.checkDocument,
    COMMANDS.checkWorkspace,
    COMMANDS.openSpeedFix,
    COMMANDS.openInspector,
] as const satisfies readonly CommandId[];

type Registered = Exclude<CommandId, typeof COMMANDS.configStatus>;

// Every command but configStatus is in the order above: leaving one out makes
// this a compile error that names it.
const everyCommandIsOrdered: [Exclude<Registered, (typeof REGISTRATION_ORDER)[number]>] extends [never] ? true : never = true;
void everyCommandIsOrdered;

export function registerCommands(subscriptions: vscode.Disposable[], app: App): void {
    // Typed as every handler, so a command without one is a compile error.
    const handlers: Pick<AllCommandHandlers, Registered> = {
        ...coreCommands(app),
        ...diagnosticsCommands(app),
        ...settingsCommands(app),
        ...checkCommands(app),
    };
    // Generic per id, so each handler is checked against its own arguments.
    const register = <C extends Registered>(id: C) => registerCommand(id, handlers[id]);
    for (const id of REGISTRATION_ORDER) {
        subscriptions.push(register(id));
    }
}
