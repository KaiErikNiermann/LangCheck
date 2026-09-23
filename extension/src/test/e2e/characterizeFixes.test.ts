/**
 * What the diagnostic actions do today, pinned before `extension.ts` is split.
 *
 * These are characterization tests: the expected values are what the extension
 * produced when they were written, not a specification. They cover the paths
 * no other suite reached -- `applyFix` and `ignoreDiagnostic` by id, both
 * "fix all" commands, the full quick-fix list, the inlay hint toggle, the
 * re-check on save, a core restart and the public API -- so that moving that
 * code between modules cannot quietly change any of it. A value here changing
 * is a behaviour change, and should be one somebody decided on.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { eventually, fixture, fixtureRoot, inlayHints, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
const EXTENSION_ID = 'KaiErikNiermann.language-check';

/** Commands registered in code but deliberately absent from the manifest. */
const INTERNAL_COMMANDS = [
    'language-check.addToDictionary',
    'language-check.applyFix',
    'language-check.configStatus',
    'language-check.deactivateRule',
    'language-check.fixAllSpellingInFile',
    'language-check.fixAllSpellingInWorkspace',
    'language-check.hideLatexEnvHint',
    'language-check.ignoreDiagnostic',
];

/** The text under each of this extension's squiggles, in collection order. */
function spans(document: vscode.TextDocument): string[] {
    return ourDiagnostics(document.uri).map(d => document.getText(d.range));
}

/**
 * Every code action offered over `range`, asking again if VS Code cancels.
 *
 * A request is cancelled when the document's diagnostics change while it is
 * in flight, which a re-check landing at the same moment does. That says
 * nothing about the actions, so it is retried, not failed on.
 */
async function codeActions(uri: vscode.Uri, range: vscode.Range): Promise<vscode.CodeAction[]> {
    return eventually('code actions that were not cancelled', async () => {
        try {
            return await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider', uri, range) ?? [];
        } catch (err) {
            if (err instanceof Error && err.message === 'Canceled') return undefined;
            throw err;
        }
    }, BUDGET_MS);
}

async function checked(name: string, expected: string[]): Promise<vscode.TextDocument> {
    const document = await openInEditor(fixture(name));
    try {
        await eventually(
            `${name} to report ${expected.join(', ')}`,
            () => (JSON.stringify(spans(document)) === JSON.stringify(expected) ? true : undefined),
            BUDGET_MS,
        );
    } catch (err) {
        throw new Error(`${String(err)}; last seen: ${JSON.stringify(spans(document))}`, { cause: err });
    }
    return document;
}

suite('characterization: diagnostic actions', () => {
    const originals = new Map<string, string>();

    suiteSetup(async function () {
        this.timeout(90_000);
        // Ignores are written to the workspace; a leftover store from an
        // earlier run would hide the finding the ignore test starts from.
        fs.rmSync(path.join(fixtureRoot(), '.languagecheck'), { recursive: true, force: true });
        for (const name of ['save.md']) {
            originals.set(name, fs.readFileSync(fixture(name).fsPath, 'utf8'));
        }
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension);
        await extension.activate();
    });

    suiteTeardown(() => {
        for (const [name, text] of originals) fs.writeFileSync(fixture(name).fsPath, text);
    });

    test('every manifest command and every internal one is registered', async () => {
        const manifest = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON as {
            contributes: { commands: { command: string }[] };
        };
        const registered = new Set(await vscode.commands.getCommands(true));
        const expected = [...manifest.contributes.commands.map(c => c.command), ...INTERNAL_COMMANDS];
        const missing = expected.filter(id => !registered.has(id));
        assert.deepStrictEqual(missing, [], `not registered: ${missing.join(', ')}`);
        const ours = [...registered].filter(id => id.startsWith('language-check.')).sort();
        assert.deepStrictEqual(ours, [...new Set(expected)].sort(), 'an unexpected command is registered');
    });

    test('the quick fixes offered for a misspelling, in order', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await checked('actions.md', ['recieve']);
        const [diagnostic] = ourDiagnostics(document.uri);
        const actions = await codeActions(document.uri, diagnostic!.range);
        // Only ours: VS Code's own providers (Markdown snippets, chat) answer
        // the same request, and their list is not this extension's behaviour.
        // `executeCodeActionProvider` drops the diagnostics an action carries,
        // so ours are told apart by what they do: an edit titled "Fix", or one
        // of this extension's commands.
        const ours = (actions ?? [])
            .filter(a => a.title.startsWith('Fix: ') || a.command?.command.startsWith('language-check.'))
            .map(a => ({
                title: a.title,
                command: a.command?.command ?? null,
                args: a.command?.arguments ?? null,
                preferred: a.isPreferred ?? false,
            }));
        assert.deepStrictEqual(ours, EXPECTED_ACTIONS, JSON.stringify(ours, null, 2));
    });

    test('inlay hints, and the toggle that hides and restores them', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await checked('actions.md', ['recieve']);
        const labels = async () => (await inlayHints(document)).map(h =>
            typeof h.label === 'string' ? h.label : h.label.map(p => p.value).join(''));

        const before = await eventually('a suggestion hint', async () => {
            const found = await labels();
            return found.length > 0 ? found : undefined;
        }, BUDGET_MS);
        assert.deepStrictEqual(before, EXPECTED_HINTS, JSON.stringify(before));

        await vscode.commands.executeCommand('language-check.toggleInlayHints');
        assert.deepStrictEqual(await labels(), [], 'hints survived being toggled off');
        await vscode.commands.executeCommand('language-check.toggleInlayHints');
        assert.deepStrictEqual(await labels(), before, 'hints did not come back');
    });

    test('the public API reports what the core found, with its severity strings', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
        const api = extension.exports as {
            version: string;
            checkDocument(uri: vscode.Uri): Promise<{
                startByte: number; endByte: number; message: string; ruleId: string;
                unifiedId: string; severity: string; suggestions: string[]; confidence: number;
            }[]>;
        };
        const uri = fixture('api.md');
        const text = fs.readFileSync(uri.fsPath, 'utf8');
        const found = await eventually('the API to answer', async () => {
            const result = await api.checkDocument(uri);
            return result.length > 0 ? result : undefined;
        }, BUDGET_MS);
        const seen = found.map(d => ({
            text: Buffer.from(text, 'utf8').subarray(d.startByte, d.endByte).toString('utf8'),
            ruleId: d.ruleId,
            severity: d.severity,
            firstSuggestion: d.suggestions[0] ?? null,
        }));
        assert.deepStrictEqual(seen, EXPECTED_API, JSON.stringify(seen, null, 2));
    });

    test('applyFix by id replaces the text and drops the finding', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await checked('apply.md', ['Teh']);
        await vscode.commands.executeCommand('language-check.applyFix', 'diag-0', 'The');
        assert.strictEqual(document.getText(), '# Apply\n\nThe cat sat on the mat.\n');
        await eventually('the fixed finding to go', () =>
            spans(document).length === 0 ? true : undefined, BUDGET_MS);
    });

    test('ignoreDiagnostic by id silences that finding across a re-check', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await checked('ignore.md', ['recieve']);
        await vscode.commands.executeCommand('language-check.ignoreDiagnostic', 'diag-0');
        await eventually('the ignored finding to go', () =>
            spans(document).length === 0 ? true : undefined, BUDGET_MS);
        const outcome = await vscode.commands.executeCommand<{ diagnostics: number }>(
            'language-check.checkDocument',
        );
        assert.strictEqual(outcome?.diagnostics, 0, 'the ignore did not survive a re-check');
    });

    test('fixAllSpellingInFile is offered for a repeated word and replaces every occurrence', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // Harper also flags the heading's capitalization; it is not a spelling
        // rule, so the fix-all leaves it alone.
        const document = await checked('fixall.md', ['# Fix all', 'recieve', 'recieve']);
        const first = ourDiagnostics(document.uri)[1]!;
        const actions = await codeActions(document.uri, first.range);
        const fixAll = (actions ?? [])
            .filter(a => a.command?.command.startsWith('language-check.fixAll'))
            .map(a => ({ title: a.title, command: a.command!.command, args: a.command!.arguments }));
        assert.deepStrictEqual(fixAll, [
            {
                title: 'Fix all "recieve" in this file',
                command: 'language-check.fixAllSpellingInFile',
                args: [document.uri.toString(), 'recieve', 'receive'],
            },
            {
                title: 'Fix all "recieve" in workspace',
                command: 'language-check.fixAllSpellingInWorkspace',
                args: ['recieve', 'receive'],
            },
        ], JSON.stringify(fixAll, null, 2));

        await vscode.commands.executeCommand(
            'language-check.fixAllSpellingInFile', document.uri.toString(), 'recieve', 'receive');
        assert.strictEqual(document.getText(), '# Fix all\n\nThey receive letters and receive parcels.\n');
        await eventually('both spelling findings to go', () =>
            JSON.stringify(spans(document)) === JSON.stringify(['# Fix all']) ? true : undefined, BUDGET_MS);
    });

    test('fixAllSpellingInWorkspace replaces the word in every open document', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const first = await checked('workspaceA.md', ['thier']);
        const second = await checked('workspaceB.md', ['thier']);
        await vscode.commands.executeCommand('language-check.fixAllSpellingInWorkspace', 'thier', 'their');
        assert.strictEqual(first.getText(), '# First\n\nThe dogs wagged their tails.\n');
        assert.strictEqual(second.getText(), '# Second\n\nThe birds sang their songs.\n');
        await eventually('both findings to go', () =>
            spans(first).length === 0 && spans(second).length === 0 ? true : undefined, BUDGET_MS);
    });

    test('under the default onSave trigger, an edit is checked on save and not before', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const document = await checked('save.md', []);
        const editor = await vscode.window.showTextDocument(document);
        await editor.edit(edit => edit.insert(document.positionAt(document.getText().length), 'Anothr line.\n'));
        await new Promise(resolve => setTimeout(resolve, 3_000));
        assert.deepStrictEqual(spans(document), [], 'an unsaved edit was checked under onSave');
        await document.save();
        await eventually('the saved edit to be checked', () =>
            spans(document).includes('Anothr') ? true : undefined, BUDGET_MS);
    });

    test('SpeedFix and the Inspector open over a checked document without an error', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await checked('actions.md', ['recieve']);
        const errors: string[] = [];
        const original = vscode.window.showErrorMessage;
        (vscode.window as unknown as Record<string, unknown>).showErrorMessage = (message: string) => {
            errors.push(message);
            return Promise.resolve(undefined);
        };
        try {
            await vscode.commands.executeCommand('language-check.openSpeedFix');
            await vscode.commands.executeCommand('language-check.openInspector');
            // Opening either again reveals the existing panel rather than making a second.
            await vscode.commands.executeCommand('language-check.openSpeedFix');
            await new Promise(resolve => setTimeout(resolve, 2_000));
        } finally {
            (vscode.window as unknown as Record<string, unknown>).showErrorMessage = original;
            await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
        }
        assert.deepStrictEqual(errors, []);
        await vscode.window.showTextDocument(document);
        assert.deepStrictEqual(spans(document), ['recieve'], 'the panels changed what is on screen');
    });

    test('restarting the core leaves it able to check', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await checked('actions.md', ['recieve']);
        await vscode.commands.executeCommand('language-check.restartLanguageServer');
        const outcome = await eventually('a check after the restart', async () => {
            const result = await vscode.commands.executeCommand<{ diagnostics: number }>(
                'language-check.checkDocument');
            return result && result.diagnostics > 0 ? result : undefined;
        }, BUDGET_MS);
        assert.strictEqual(outcome.diagnostics, 1);
    });
});

// Pinned from the extension as it was when these tests were written.
// VS Code lists the preferred fix first; the rest keep the provider's order.
const EXPECTED_ACTIONS: unknown[] = [
    { title: 'Fix: "receive"', command: null, args: null, preferred: true },
    { title: 'Add "recieve" to dictionary', command: 'language-check.addToDictionary', args: ['recieve'], preferred: false },
    { title: 'Ignore this issue', command: 'language-check.ignoreDiagnostic', args: ['diag-0'], preferred: false },
    {
        title: 'Deactivate rule "harper.Spelling"',
        command: 'language-check.deactivateRule',
        args: ['harper.Spelling'],
        preferred: false,
    },
    { title: 'Fix: "relieve"', command: null, args: null, preferred: false },
    { title: 'Fix: "recipe"', command: null, args: null, preferred: false },
];
const EXPECTED_HINTS: string[] = [' → receive'];
// "error" for a Harper capitalization finding, which the core sends as
// SEVERITY_INFORMATION: the API's mapping is off by one against the proto.
// Pinned as it is; fixing it is a separate, deliberate change.
const EXPECTED_API: unknown[] = [
    { text: 'Api', ruleId: 'harper.Capitalization', severity: 'error', firstSuggestion: 'API' },
    { text: 'recieve', ruleId: 'harper.Spelling', severity: 'warning', firstSuggestion: 'receive' },
];
