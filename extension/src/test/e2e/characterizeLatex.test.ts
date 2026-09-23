/**
 * The LaTeX inlay hints and the three config writes behind them, pinned before
 * `extension.ts` is split.
 *
 * Characterization tests: the expected hints and the exact config text are
 * what the extension produced when these were written. The config edits are
 * string transforms over YAML, so the whole resulting file is asserted --
 * which key it lands under and how it is indented is the behaviour.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { eventually, fixture, inlayHints, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

interface Hint {
    line: number;
    label: string;
    commands: string[];
}

async function hints(document: vscode.TextDocument): Promise<Hint[]> {
    return (await inlayHints(document))
        .map(h => ({
            line: h.position.line,
            label: typeof h.label === 'string' ? h.label : h.label.map(p => p.value).join(''),
            commands: typeof h.label === 'string'
                ? []
                : h.label.flatMap(p => (p.command ? [`${p.command.command}(${p.command.arguments?.join(',')})`] : [])),
        }))
        .sort((a, b) => a.line - b.line || a.label.localeCompare(b.label));
}

suite('characterization: LaTeX hints and skip lists', () => {
    const configPath = () => fixture('.languagecheck.yaml').fsPath;
    let original = '';
    let document: vscode.TextDocument;

    const config = () => fs.readFileSync(configPath(), 'utf8');

    async function hintsBecome(expected: Hint[], what: string): Promise<void> {
        let last: Hint[] = [];
        try {
            await eventually(what, async () => {
                last = await hints(document);
                return JSON.stringify(last) === JSON.stringify(expected) ? true : undefined;
            }, BUDGET_MS);
        } catch (err) {
            throw new Error(`${String(err)}\nlast seen: ${JSON.stringify(last, null, 2)}`, { cause: err });
        }
    }

    suiteSetup(async function () {
        this.timeout(90_000);
        original = config();
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
        document = await openInEditor(fixture('doc.tex'));
        await eventually('the LaTeX document to be checked', () =>
            ourDiagnostics(document.uri).length > 0 ? true : undefined, BUDGET_MS);
    });

    suiteTeardown(() => {
        fs.writeFileSync(configPath(), original);
    });

    test('the squiggles land on the misspellings, not on markup', () => {
        const spans = ourDiagnostics(document.uri).map(d => document.getText(d.range));
        assert.deepStrictEqual(spans, EXPECTED_SPANS, JSON.stringify(spans));
    });

    test('every hint on the document, before any skip', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await hintsBecome(EXPECTED_HINTS_BEFORE, 'the initial hints');
    });

    test('skipLatexEnv writes skip_environments and the hint goes', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.commands.executeCommand('language-check.skipLatexEnv', 'sidenote');
        assert.strictEqual(config(), EXPECTED_CONFIG_AFTER_SKIP_ENV);
        await hintsBecome(EXPECTED_HINTS_AFTER_SKIP_ENV, 'the sidenote hints to go');
    });

    test('hideLatexEnvHint writes prose_environments and the hint goes', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.commands.executeCommand('language-check.hideLatexEnvHint', 'margintext');
        assert.strictEqual(config(), EXPECTED_CONFIG_AFTER_HIDE_ENV);
        await hintsBecome(EXPECTED_HINTS_AFTER_HIDE_ENV, 'the margintext hint to go');
    });

    test('skipLatexCommand writes skip_commands and the hint goes', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.commands.executeCommand('language-check.skipLatexCommand', 'annotate');
        assert.strictEqual(config(), EXPECTED_CONFIG_AFTER_SKIP_COMMAND);
        await hintsBecome(EXPECTED_HINTS_AFTER_SKIP_COMMAND, 'the annotate hints to go');
    });
});

// Pinned from the extension as it was when these tests were written.
const EXPECTED_SPANS = ['mispelled', 'Anothr', 'mispelled'];

const envHints = (line: number, env: string): Hint => ({
    line,
    label: ' \u2298 skip | hide hint',
    commands: [`language-check.skipLatexEnv(${env})`, `language-check.hideLatexEnvHint(${env})`],
});
const fixHint = (line: number, id: number, to: string): Hint => ({
    line,
    label: ` \u2192 ${to}`,
    commands: [`language-check.applyFix(diag-${id},${to})`],
});
const commandHint = (line: number, name: string): Hint => ({
    line,
    label: ' \u2298 skip',
    commands: [`language-check.skipLatexCommand(${name})`],
});

const EXPECTED_HINTS_BEFORE: Hint[] = [
    envHints(3, 'sidenote'),
    fixHint(4, 0, 'misspelled'),
    envHints(7, 'margintext'),
    fixHint(11, 1, 'Another'),
    fixHint(11, 2, 'misspelled'),
    commandHint(11, 'annotate'),
];
// Skipping the environment drops its finding too, so the ids shift down.
const EXPECTED_HINTS_AFTER_SKIP_ENV: Hint[] = [
    envHints(7, 'margintext'),
    fixHint(11, 0, 'Another'),
    fixHint(11, 1, 'misspelled'),
    commandHint(11, 'annotate'),
];
const EXPECTED_HINTS_AFTER_HIDE_ENV: Hint[] = [
    fixHint(11, 0, 'Another'),
    fixHint(11, 1, 'misspelled'),
    commandHint(11, 'annotate'),
];
// The command's argument was the last prose with a finding in it.
const EXPECTED_HINTS_AFTER_SKIP_COMMAND: Hint[] = [];

const ORIGINAL_BODY = [
    '# Harper only. The LaTeX skip commands append to this file, so the suites',
    '# restore it afterwards; it is the starting state they compare against.',
    'engines:',
    '  harper: true',
    '',
].join('\n');
const EXPECTED_CONFIG_AFTER_SKIP_ENV = [
    'languages:', '  latex:', '    skip_environments:', '      - sidenote', '',
].join('\n') + ORIGINAL_BODY;
const EXPECTED_CONFIG_AFTER_HIDE_ENV = [
    'languages:', '  latex:', '    prose_environments:', '      - margintext',
    '    skip_environments:', '      - sidenote', '',
].join('\n') + ORIGINAL_BODY;
const EXPECTED_CONFIG_AFTER_SKIP_COMMAND = [
    'languages:', '  latex:', '    skip_commands:', '      - annotate',
    '    prose_environments:', '      - margintext',
    '    skip_environments:', '      - sidenote', '',
].join('\n') + ORIGINAL_BODY;
