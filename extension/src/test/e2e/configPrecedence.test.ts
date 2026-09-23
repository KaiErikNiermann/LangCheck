/**
 * Which config applies when more than one could.
 *
 * Characterization tests of the model as it is: one config per workspace, read
 * from the root of the first workspace folder, with `.yaml` preferred to `.yml`
 * to `.json` when several sit there. A config in a subfolder is never read for
 * checking, however close it is to the file. See "Where the config is read
 * from" in docs/guide/configuration.md; a change here is a change to that
 * documented behaviour.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

function spans(document: vscode.TextDocument): string[] {
    return ourDiagnostics(document.uri).map(d => document.getText(d.range));
}

async function reportsTypo(name: string): Promise<vscode.TextDocument> {
    const document = await openInEditor(fixture(name));
    await eventually(`${name} to report its typo`, () =>
        spans(document).includes('recieve') ? true : undefined, BUDGET_MS);
    return document;
}

suite('config precedence', () => {
    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('at the root, .languagecheck.yaml is used and .languagecheck.json beside it is not', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await reportsTypo('root.md');
    });

    test('a config in a subfolder does not apply to the files under it', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await reportsTypo('sub/nested.md');
    });

    test('control: the same rule-off block in the root config does silence the typo', async function () {
        // Without this, the tests above would also pass if the rules block
        // in the ignored configs were simply malformed.
        this.timeout(BUDGET_MS + 30_000);
        const rootConfig = fixture('.languagecheck.yaml').fsPath;
        const original = fs.readFileSync(rootConfig, 'utf8');
        const document = await reportsTypo('sub/nested.md');
        try {
            fs.writeFileSync(rootConfig, original + 'rules:\n  harper.Spelling:\n    severity: "off"\n');
            await eventually('the root rule to silence the typo', () =>
                spans(document).includes('recieve') ? undefined : true, BUDGET_MS);
        } finally {
            fs.writeFileSync(rootConfig, original);
        }
        await eventually('the typo to come back once the root config is restored', () =>
            spans(document).includes('recieve') ? true : undefined, BUDGET_MS);
    });

    test('editing a subfolder config changes nothing', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const nestedConfig = fixture('sub/.languagecheck.yaml').fsPath;
        const original = fs.readFileSync(nestedConfig, 'utf8');
        const document = await reportsTypo('sub/nested.md');
        try {
            fs.writeFileSync(nestedConfig, 'engines:\n  harper: false\n');
            // Long enough for the config watcher, which does fire, to have
            // re-read the root config and found it unchanged.
            await new Promise(resolve => setTimeout(resolve, 4_000));
            assert.deepStrictEqual(spans(document), ['recieve'], 'the nested config was applied');
        } finally {
            fs.writeFileSync(nestedConfig, original);
        }
    });
});
