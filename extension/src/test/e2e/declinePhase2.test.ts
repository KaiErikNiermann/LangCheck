/**
 * The same workspace in a second window, after phase one refused the offer.
 *
 * What this can and cannot show, because the difference matters:
 *
 * It CANNOT show that a refusal survives a reload. A refusal is stored in
 * `globalState`, and VS Code under @vscode/test-electron never flushes that to
 * disk -- no test profile grows a `state.vscdb`, where a real profile has one.
 * So a second launch starts with an empty memory however long phase one waits,
 * and an assertion that the offer stays away would be asserting the harness.
 * That invariant is covered in `src/test/packPrompt.test.ts`, against a
 * Memento that does persist.
 *
 * It CAN show the half that no unit test reaches: that a refused language
 * still reports itself as unchecked, and that the install stays reachable from
 * the squiggle. Hiding the popup must not hide the feature, which was the
 * whole condition on suppressing it.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

suite('pack offer, phase two: the squiggle outlives the popup', () => {
    test('the unchecked-language diagnostic is still reported', async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        const uri = fixture('hebrew.md');
        await openInEditor(uri);

        await eventually(
            'the no-provider diagnostic',
            () => ourDiagnostics(uri).some(d => d.code === 'languagecheck.no-provider') || undefined,
            30_000,
        );
    });

    test('the install is still offered as a quick fix', async function () {
        this.timeout(60_000);
        const uri = fixture('hebrew.md');
        const document = await openInEditor(uri);

        const diagnostic = await eventually(
            'the no-provider diagnostic',
            () => ourDiagnostics(uri).find(d => d.code === 'languagecheck.no-provider'),
            30_000,
        );

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            diagnostic.range,
        );
        const titles = (actions ?? []).map(a => a.title);
        assert.ok(
            titles.some(t => /install/i.test(t)),
            `refusing the popup must leave the install reachable; offered: ${titles.join(' | ') || '(none)'}`,
        );
    });
});
