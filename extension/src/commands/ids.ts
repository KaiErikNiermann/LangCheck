/**
 * Every command the extension registers, with the arguments each one takes.
 *
 * The manifest's commands come from `generated/meta.ts`; the rest are
 * registered in code but deliberately left out of package.json, because they
 * are invoked from hints, code actions and webviews with arguments, never from
 * the command palette. The wrappers below are the only way the extension names
 * a command, so an id typo or a wrong argument list fails to compile.
 */
import * as vscode from 'vscode';

import { commands as manifestCommands } from '../generated/meta';

export const INTERNAL_COMMANDS = {
    addToDictionary: 'language-check.addToDictionary',
    applyFix: 'language-check.applyFix',
    configStatus: 'language-check.configStatus',
    deactivateRule: 'language-check.deactivateRule',
    fixAllSpellingInFile: 'language-check.fixAllSpellingInFile',
    fixAllSpellingInWorkspace: 'language-check.fixAllSpellingInWorkspace',
    hideLatexEnvHint: 'language-check.hideLatexEnvHint',
    ignoreDiagnostic: 'language-check.ignoreDiagnostic',
} as const;

export const COMMANDS = { ...manifestCommands, ...INTERNAL_COMMANDS } as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/** The arguments of each command that takes any. */
interface CommandArgs {
    'language-check.addToDictionary': [word: string];
    'language-check.applyFix': [diagnosticId: string, suggestion: string];
    'language-check.configStatus': [uri?: string];
    'language-check.deactivateRule': [ruleId: string];
    'language-check.fixAllSpellingInFile': [uri: string, word: string, replacement: string];
    'language-check.fixAllSpellingInWorkspace': [word: string, replacement: string];
    'language-check.hideLatexEnvHint': [envName: string];
    'language-check.ignoreDiagnostic': [diagnosticId: string];
    'language-check.ignoreSelection': [uri?: string, startOffset?: number, endOffset?: number];
    'language-check.installPack': [language: string];
    'language-check.skipLatexCommand': [cmdName: string];
    'language-check.skipLatexEnv': [envName: string];
}

export type ArgsOf<C extends CommandId> = C extends keyof CommandArgs ? CommandArgs[C] : [];

export function registerCommand<C extends CommandId>(id: C, handler: (...args: ArgsOf<C>) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown);
}

export function executeCommand<R = unknown, C extends CommandId = CommandId>(id: C, ...args: ArgsOf<C>): Thenable<R> {
    return vscode.commands.executeCommand<R>(id, ...args);
}

/** A command reference for a hint or a code action, which VS Code runs with these arguments. */
export function commandLink<C extends CommandId>(id: C, title: string, ...args: ArgsOf<C>): vscode.Command {
    return { command: id, title, arguments: args };
}
