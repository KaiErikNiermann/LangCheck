/**
 * Silencing every finding over one span.
 *
 * "Ignore this issue" is keyed on a single diagnostic's message, so a phrase
 * more than one engine dislikes takes one trip through the lightbulb per
 * engine -- and the second only appears once the first has gone. This action
 * takes the span instead.
 *
 * The two things worth pinning are that it silences everything the selection
 * reaches, and that it silences nothing it does not: a suppression the user
 * did not ask for is one they will never think to look for.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { eventually, fixture, fixtureRoot, openInEditor, ourDiagnostics } from './helpers';
import * as path from 'path';

const BUDGET_MS = 45_000;

suite('ignoring every issue in a selection', () => {
    let document: vscode.TextDocument;

    const words = () => new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );

    suiteSetup(async function () {
        this.timeout(90_000);
        // An ignore is durable by design: it is written to the workspace so
        // it survives a reload. That makes this suite non-repeatable unless
        // the store is cleared first -- the second run would find the words
        // it silenced on the first already gone, and wait for them for ever.
        fs.rmSync(path.join(fixtureRoot(), '.languagecheck'), {
            recursive: true,
            force: true,
        });

        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
        document = await openInEditor(fixture('doc.md'));
        await eventually(
            'every misspelling to be reported',
            () => {
                const found = words();
                return found.has('recieve') && found.has('teh')
                    && found.has('seperate') && found.has('definately')
                    ? true
                    : undefined;
            },
            BUDGET_MS,
        );
    });

    test('a selection covering two findings silences both and leaves the rest', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const text = document.getText();
        const first = text.indexOf('recieve');
        const second = text.indexOf('teh') + 'teh'.length;
        assert.ok(first > 0 && second > first, 'the fixture still holds both typos');

        await vscode.commands.executeCommand(
            'language-check.ignoreSelection',
            document.uri.toString(),
            first,
            second,
        );

        await eventually(
            'both selected findings to go',
            () => {
                const found = words();
                return !found.has('recieve') && !found.has('teh') ? true : undefined;
            },
            BUDGET_MS,
        );

        // The two outside the selection are untouched. Asserted after a wait
        // long enough for a stray re-check to have landed.
        await new Promise(resolve => setTimeout(resolve, 3_000));
        const found = words();
        assert.ok(found.has('seperate'), 'a finding outside the selection was silenced');
        assert.ok(found.has('definately'), 'a finding outside the selection was silenced');
    });

    test('a selection that reaches nothing silences nothing', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const before = words();
        const text = document.getText();
        // The heading, which nothing reports on.
        await vscode.commands.executeCommand(
            'language-check.ignoreSelection',
            document.uri.toString(),
            0,
            text.indexOf('\n'),
        );
        await new Promise(resolve => setTimeout(resolve, 2_000));
        assert.deepStrictEqual(words(), before, 'an empty selection changed the diagnostics');
    });

    test('the action is offered, and says how many it covers', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const text = document.getText();
        const from = document.positionAt(text.indexOf('seperate'));
        const to = document.positionAt(text.indexOf('definately') + 'definately'.length);

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            new vscode.Range(from, to),
        );
        const offered = (actions ?? []).find(
            a => a.command?.command === 'language-check.ignoreSelection',
        );
        assert.ok(offered, `the action was not offered: ${(actions ?? []).map(a => a.title)}`);
        assert.match(offered.title, /2 issues/);
    });
});
