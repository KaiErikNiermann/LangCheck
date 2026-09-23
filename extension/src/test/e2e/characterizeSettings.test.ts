/**
 * The commands that rewrite configuration, pinned before `extension.ts` is
 * split.
 *
 * Characterization tests: the expected file contents are what the extension
 * wrote when these were written. The quick picks are answered by stubbing
 * `showQuickPick`, and the offered labels are asserted too, since the list a
 * user chooses from is part of the command.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { eventually, fixture, fixtureRoot, openInEditor, ourDiagnostics } from './helpers';
import { recordPrompts } from './promptMemory';
import { answerQuickPick } from './quickPick';

const BUDGET_MS = 45_000;

suite('characterization: settings commands', () => {
    const configPath = () => fixture('.languagecheck.yaml').fsPath;
    const config = () => fs.readFileSync(configPath(), 'utf8');
    let original = '';

    suiteSetup(async function () {
        this.timeout(90_000);
        original = config();
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
        const document = await openInEditor(fixture('doc.md'));
        await eventually('the document to be checked', () =>
            ourDiagnostics(document.uri).length > 0 ? true : undefined, BUDGET_MS);
    });

    suiteTeardown(async () => {
        fs.writeFileSync(configPath(), original);
        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.trigger', undefined, vscode.ConfigurationTarget.Workspace);
        fs.rmSync(path.join(fixtureRoot(), '.vscode'), { recursive: true, force: true });
    });

    test('managePlugins with none configured says so', async () => {
        const prompts = recordPrompts();
        try {
            await vscode.commands.executeCommand('language-check.managePlugins');
        } finally {
            prompts.restore();
        }
        assert.deepStrictEqual(prompts.seen.map(p => p.message), [
            'No plugins configured. Add plugins in settings (languageCheck.plugins).',
        ]);
    });

    test('toggleCheckTrigger flips the workspace setting both ways', async () => {
        const trigger = () => vscode.workspace.getConfiguration('languageCheck').get<string>('check.trigger');
        assert.strictEqual(trigger(), 'onSave');
        const prompts = recordPrompts();
        try {
            await vscode.commands.executeCommand('language-check.toggleCheckTrigger');
            assert.strictEqual(trigger(), 'onChange');
            await vscode.commands.executeCommand('language-check.toggleCheckTrigger');
            assert.strictEqual(trigger(), 'onSave');
        } finally {
            prompts.restore();
        }
        assert.deepStrictEqual(prompts.seen.map(p => p.message), [
            'Switched to check on change',
            'Switched to check on save',
        ]);
    });

    test('manageEngines offers the four engines and writes the choice', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const pick = answerQuickPick(['Harper']);
        const prompts = recordPrompts();
        try {
            await vscode.commands.executeCommand('language-check.manageEngines');
        } finally {
            pick.restore();
            prompts.restore();
        }
        assert.deepStrictEqual(pick.offered, [['Harper', 'LanguageTool', 'Vale', 'Proselint']]);
        assert.strictEqual(config(), EXPECTED_CONFIG_AFTER_ENGINES);
    });

    test('selectLanguage writes spell_language under engines', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const pick = answerQuickPick(['en-GB']);
        const prompts = recordPrompts();
        try {
            await vscode.commands.executeCommand('language-check.selectLanguage');
        } finally {
            pick.restore();
            prompts.restore();
        }
        assert.strictEqual(pick.offered[0]?.length, 22, JSON.stringify(pick.offered));
        assert.strictEqual(config(), EXPECTED_CONFIG_AFTER_LANGUAGE);
        assert.deepStrictEqual(prompts.seen.map(p => p.message), [
            'Spell-check language set to "en-GB". Reloading...',
        ]);
    });
});

// Pinned from the extension as it was when these tests were written. The
// engines are prepended one at a time under `engines:`, so they land in the
// reverse of the order they are listed in.
const HEADER = '# The settings commands rewrite this file; the suite restores it afterwards.\n';
const EXPECTED_CONFIG_AFTER_ENGINES = HEADER + [
    'engines:', '  proselint: false', '  vale: false', '  languagetool: false', '  harper: true', '',
].join('\n');
const EXPECTED_CONFIG_AFTER_LANGUAGE = HEADER + [
    'engines:', '  spell_language: en-GB', '  proselint: false', '  vale: false',
    '  languagetool: false', '  harper: true', '',
].join('\n');
