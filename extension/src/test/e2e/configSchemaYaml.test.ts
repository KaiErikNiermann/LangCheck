/**
 * The config schema in `.languagecheck.yaml`, through the Red Hat YAML extension.
 *
 * VS Code has no YAML language server of its own. This suite runs with
 * `redhat.vscode-yaml` installed, which reads the `yamlValidation` entry in the
 * manifest, so it covers the path most users take to completion in the config.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor } from './helpers';

const BUDGET_MS = 45_000;
const YAML_EXTENSION_ID = 'redhat.vscode-yaml';

suite('config schema (YAML)', () => {
    suiteSetup(async function () {
        this.timeout(BUDGET_MS);
        const yaml = vscode.extensions.getExtension(YAML_EXTENSION_ID);
        assert.ok(yaml, `${YAML_EXTENSION_ID} is not installed in the test instance`);
        await yaml.activate();
    });

    test('a typo and a bad value are flagged', async function () {
        this.timeout(BUDGET_MS + 10_000);
        const uri = fixture('.languagecheck.yaml');
        await openInEditor(uri);

        const messages = await eventually(
            'schema diagnostics on .languagecheck.yaml',
            () => {
                const found = vscode.languages
                    .getDiagnostics(uri)
                    .filter(d => d.source !== 'language-check')
                    .map(d => d.message);
                return found.some(m => m.includes('enabeld')) && found.some(m => m.includes('picky'))
                    ? found
                    : undefined;
            },
            BUDGET_MS,
        );
        assert.ok(messages.length >= 2, messages.join(' | '));
    });

    test('engine names are offered as completions', async function () {
        this.timeout(BUDGET_MS + 10_000);
        const document = await openInEditor(fixture('.languagecheck.yaml'));
        const position = document.positionAt(document.getText().indexOf('harper'));

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
                return found.some(label => label.includes('hunspell')) ? found : undefined;
            },
            BUDGET_MS,
        );
        assert.ok(labels.some(label => label.includes('vale')), labels.join(', '));
    });
});
