/**
 * Phase one of the suppression test: raise the offer and refuse it.
 *
 * Split across two VS Code launches on purpose. A refusal that only survives
 * within one session is not suppression -- the complaint this guards against
 * is a popup coming back after a reload. Phase two runs in a second window
 * against the same user data directory and asserts it stays gone, so the two
 * halves must not be merged into one test.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';
import { recordPrompts } from './promptMemory';

/** As `extension.ts` builds it, through `vscode.l10n.t` with no bundle loaded. */
const NEVER = "Don't ask again";

suite('pack offer, phase one: refuse it', () => {
    test('a language nothing can read is offered a dictionary, and the refusal is taken', async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        // Installed before the document opens: the offer is raised from the
        // check, and a recorder installed afterwards would miss it.
        const prompts = recordPrompts(NEVER);
        try {
            const uri = fixture('hebrew.md');
            await openInEditor(uri);

            await eventually(
                'the no-provider diagnostic the offer is keyed on',
                () => ourDiagnostics(uri).some(d => d.code === 'languagecheck.no-provider') || undefined,
                30_000,
            );

            const offers = await eventually(
                'an install offer naming Hebrew',
                () => {
                    const found = prompts.forLanguage('he');
                    return found.length > 0 ? found : undefined;
                },
                15_000,
            );

            assert.ok(
                offers[0]!.items.includes(NEVER),
                `the offer must carry a permanent refusal, got: ${offers[0]!.items.join(', ')}`,
            );

            // The refusal is written to globalState after the answer is
            // returned, and this test's job is done the moment the answer is
            // recorded -- so without waiting, the window can close before the
            // write lands and phase two would fail for a reason that has
            // nothing to do with the extension.
            //
            // A second check must raise no second offer. This proves the
            // in-session half of the suppression only -- `packsOfferedThisSession`
            // would stop it even if the refusal were never stored -- and the
            // storing half is covered in src/test/packPrompt.test.ts, because
            // the harness does not persist globalState. See declinePhase2.
            const before = prompts.seen.length;
            await vscode.commands.executeCommand('language-check.checkDocument');
            await new Promise(resolve => setTimeout(resolve, 3_000));
            assert.deepStrictEqual(
                prompts.seen.slice(before).filter(o => o.message.includes('he')).map(o => o.message),
                [],
                'the offer was raised a second time within the same session',
            );
        } finally {
            prompts.restore();
        }
    });
});
