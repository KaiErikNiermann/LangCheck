/**
 * The config schema, as VS Code's own JSON support applies it.
 *
 * The manifest registers `schemas/languagecheck.schema.json` for the config
 * files. The built-in JSON extension is the one consumer every install has, so
 * it is what proves the registration and the shipped file both work; the YAML
 * registration takes effect only once a YAML language server is installed.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor } from './helpers';

const BUDGET_MS = 20_000;

suite('config schema', () => {
    test('a typo nested inside an engine table is flagged', async function () {
        this.timeout(BUDGET_MS + 10_000);
        const uri = fixture('.languagecheck.json');
        await openInEditor(uri);

        const messages = await eventually(
            'schema diagnostics on .languagecheck.json',
            () => {
                const found = vscode.languages
                    .getDiagnostics(uri)
                    .filter(d => d.source !== 'language-check')
                    .map(d => d.message);
                return found.length >= 2 ? found : undefined;
            },
            BUDGET_MS,
        );

        assert.ok(messages.some(m => m.includes('enabeld')), messages.join(' | '));
        assert.ok(messages.some(m => /picky/.test(m)), messages.join(' | '));
    });

    test('engine names are offered as completions', async function () {
        this.timeout(BUDGET_MS + 10_000);
        const document = await openInEditor(fixture('.languagecheck.json'));
        // Just inside the `engines` object, before its first key.
        const position = document.positionAt(document.getText().indexOf('"harper"'));

        const labels = await eventually(
            'completions inside engines',
            async () => {
                const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                    'vscode.executeCompletionItemProvider',
                    document.uri,
                    position,
                );
                const found = list.items.map(item =>
                    typeof item.label === 'string' ? item.label : item.label.label,
                );
                return found.some(label => label.includes('vale')) ? found : undefined;
            },
            BUDGET_MS,
        );

        assert.ok(labels.some(label => label.includes('hunspell')), labels.join(', '));
    });
});
