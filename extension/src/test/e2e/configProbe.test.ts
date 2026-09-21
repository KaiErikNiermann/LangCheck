/**
 * What the config file shows about itself, and whether it keeps up.
 *
 * The claim being tested is not "a mark appears" but "a mark tracks the
 * world". A tick next to `languagetool:` is worth nothing if it stays green
 * after the server it names has stopped, so every case here changes something
 * -- the text, or a server on a real socket -- and then asserts the marks
 * followed, in the same window, with no reload and no command run by hand.
 *
 * Two channels are checked, because they carry different claims. Diagnostics
 * are read back through VS Code's own API, so a squiggle assertion is
 * end-to-end in the strict sense. Decorations are not readable by any API,
 * proposed or otherwise -- `setDecorations` is write-only -- so the gutter is
 * asserted against the model the extension pushed to it, which is the last
 * point this extension controls. That is a real limit and it is stated here
 * rather than papered over.
 */
import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor } from './helpers';

const BUDGET_MS = 45_000;

/** The model behind the gutter marks, as the extension last pushed it. */
interface ConfigMark {
    key: string;
    status: string;
    details: string[];
    line: number;
}
interface Snapshot {
    uri: string;
    marks: ConfigMark[];
    diagnostics: { line: number; message: string; severity: string }[];
    revision: number;
    parseError: string;
}

/**
 * A LanguageTool that serves `codes` and nothing else.
 *
 * Real HTTP on a real port: the probe's whole claim is that a request reached
 * a server, and a stub inside the extension host would leave the core's own
 * client, the URL handling and the timeout untested. The core is a
 * subprocess on this machine, so 127.0.0.1 is reachable from it.
 */
class FakeLanguageTool {
    private server: http.Server | null = null;
    public url = '';

    public async start(codes: [string, string][]): Promise<string> {
        const body = JSON.stringify(
            codes.map(([code, longCode]) => ({ name: 'Test', code, longCode })),
        );
        this.server = http.createServer((request, response) => {
            if ((request.url ?? '').startsWith('/v2/languages')) {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(body);
                return;
            }
            response.writeHead(404);
            response.end();
        });
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
        const port = (this.server!.address() as AddressInfo).port;
        this.url = `http://127.0.0.1:${port}`;
        return this.url;
    }

    public async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        if (server === null) return;
        await new Promise<void>(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        });
    }
}

/** A port nothing is listening on, found by binding one and letting it go. */
async function deadPort(): Promise<number> {
    const server = http.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
}

suite('config status, live', () => {
    let configUri: vscode.Uri;
    let configDocument: vscode.TextDocument;
    let originalConfig: string;
    const languagetool = new FakeLanguageTool();

    const snapshot = async (): Promise<Snapshot | undefined> =>
        vscode.commands.executeCommand<Snapshot | undefined>(
            'language-check.configStatus',
            configUri.toString(),
        );

    /** Marks on the line a key is written on. */
    async function markFor(key: string): Promise<ConfigMark | undefined> {
        const current = await snapshot();
        return current?.marks.find(m => m.key === key);
    }

    /** Wait until the mark for `key` reaches `status`, or give up saying so. */
    async function marked(key: string, status: string): Promise<ConfigMark> {
        return eventually(
            `${key} to be marked ${status}`,
            async () => {
                const mark = await markFor(key);
                return mark?.status === status ? mark : undefined;
            },
            BUDGET_MS,
        );
    }

    /** Diagnostics this extension put on the config file. */
    function configDiagnostics(): vscode.Diagnostic[] {
        return vscode.languages
            .getDiagnostics(configUri)
            .filter(d => d.source === 'language-check');
    }

    async function squiggleMatching(pattern: RegExp): Promise<vscode.Diagnostic> {
        return eventually(
            `a squiggle matching ${pattern}`,
            () => configDiagnostics().find(d => pattern.test(d.message)),
            BUDGET_MS,
        );
    }

    async function noSquiggleMatching(pattern: RegExp): Promise<true> {
        return eventually(
            `every squiggle matching ${pattern} to go away`,
            () => (configDiagnostics().some(d => pattern.test(d.message)) ? undefined : true),
            BUDGET_MS,
        );
    }

    /**
     * Replace the config on disk and wait for the marks to be recomputed.
     *
     * The revision is bumped on every applied render, so waiting on it is
     * waiting for the work to finish rather than for a duration to elapse.
     */
    async function write(text: string): Promise<void> {
        // Writing the bytes that are already there changes no document, so
        // nothing fires and there is no revision to wait for. That is the
        // ordinary case in teardown after a test that only read.
        if (configDocument.getText() === text && !configDocument.isDirty) return;
        const before = (await snapshot())?.revision ?? 0;
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(text, 'utf8'));
        await eventually(
            'the config marks to be recomputed',
            async () => ((await snapshot())?.revision ?? 0) > before ? true : undefined,
            BUDGET_MS,
        );
    }

    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension, 'the extension is installed in the test window');
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        originalConfig = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
        // Opened in an editor: the marks are decorations, and a decoration
        // needs a visible editor to be pushed to.
        configDocument = await openInEditor(configUri);
    });

    suiteTeardown(async function () {
        this.timeout(BUDGET_MS);
        await languagetool.stop();
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfig, 'utf8'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS);
        // Revert any unsaved edit a test left in the buffer, or the next test
        // probes text it did not write.
        if (configDocument.isDirty) {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
        await write(originalConfig);
    });

    test('an engine that is built in is marked as resolved', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const mark = await marked('engines.harper', 'ok');
        assert.ok(
            mark.details.some(d => /built in/i.test(d)),
            `the hover should say why: ${JSON.stringify(mark.details)}`,
        );
    });

    test('a disabled engine is drawn as nothing, not as broken', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await write('engines:\n  harper: true\n  vale: false\n  spell_language: "en-US"\n');
        await marked('engines.harper', 'ok');
        assert.strictEqual(
            await markFor('engines.vale'),
            undefined,
            'an engine that is switched off has no mark of any kind',
        );
    });

    test('a LanguageTool that is not there is marked down, and the url is squiggled', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const port = await deadPort();
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "http://127.0.0.1:${port}"\n  spell_language: "en-US"\n`,
        );

        await marked('engines.languagetool', 'down');
        const squiggle = await squiggleMatching(/Could not reach/i);
        // Exactly the url, and nothing either side of it. A span that ran to
        // the end of the line would underline the comment after it and read
        // as a complaint about something else.
        assert.strictEqual(
            configDocument.getText(squiggle.range),
            `"http://127.0.0.1:${port}"`,
        );
        assert.strictEqual(squiggle.severity, vscode.DiagnosticSeverity.Error);
    });

    test('a path with spaces and non-ASCII is reported whole, and reported at all', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The shape a Windows path takes, plus characters that would shift a
        // span if the offsets were bytes rather than UTF-16 indices.
        const path = 'C:/Program Files/café—ü/.vale.ini';
        await write(
            `engines:\n  harper: true\n  vale:\n    enabled: true\n` +
            `    config: "${path}"\n  spell_language: "en-US"\n`,
        );

        await marked('engines.vale', 'down');
        const squiggle = await squiggleMatching(/vale\.ini|not on PATH/i);
        const underlined = configDocument.getText(squiggle.range);
        // Either the whole quoted path, or the engine's own line when Vale is
        // not installed on the machine running this -- never a fragment of
        // the path, which is what a byte-indexed span would give.
        assert.ok(
            underlined === `"${path}"` || underlined.includes('vale'),
            `the squiggle covered ${JSON.stringify(underlined)}`,
        );
        assert.ok(
            !underlined.startsWith('rogram') && !underlined.includes('\n'),
            `the span stopped mid-path: ${JSON.stringify(underlined)}`,
        );
    });

    test('starting the server flips the mark to resolved without a reload', async function () {
        this.timeout(BUDGET_MS + 60_000);
        const port = await deadPort();
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "http://127.0.0.1:${port}"\n  spell_language: "en-US"\n`,
        );
        await marked('engines.languagetool', 'down');

        // The world changes, and nothing in the editor is touched but the
        // url. No reload, no command, no restart of the core.
        const url = await languagetool.start([['en', 'en-US']]);
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "${url}"\n  spell_language: "en-US"\n`,
        );

        const mark = await marked('engines.languagetool', 'ok');
        assert.ok(
            mark.details.some(d => /serving 1 languages/.test(d)),
            `the hover should say what answered: ${JSON.stringify(mark.details)}`,
        );
        await noSquiggleMatching(/Could not reach/i);
    });

    test('stopping the server flips it back, in the same window', async function () {
        this.timeout(BUDGET_MS + 60_000);
        const url = await languagetool.start([['en', 'en-US']]);
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "${url}"\n  spell_language: "en-US"\n`,
        );
        await marked('engines.languagetool', 'ok');

        await languagetool.stop();
        // The text has not changed, so nothing in the editor would fire on
        // its own. Touching the file is what a user would do; the assertion
        // is that the answer is recomputed rather than remembered.
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "${url}"\n  spell_language: "en-US"\n# touched\n`,
        );

        await marked('engines.languagetool', 'down');
        await squiggleMatching(/Could not reach/i);
    });

    test('a server that is up but serves the wrong language is degraded, not green', async function () {
        this.timeout(BUDGET_MS + 60_000);
        // The case a bare reachability check calls healthy and the user
        // experiences as LanguageTool silently doing nothing.
        const url = await languagetool.start([['de', 'de-DE']]);
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "${url}"\n  spell_language: "en-US"\n`,
        );

        const mark = await marked('engines.languagetool', 'degraded');
        assert.ok(
            mark.details.some(d => /does not serve/i.test(d)),
            `the hover should say what is missing: ${JSON.stringify(mark.details)}`,
        );
    });

    test('an unsaved edit is probed, so the answer arrives while it is being typed', async function () {
        this.timeout(BUDGET_MS + 60_000);
        const url = await languagetool.start([['en', 'en-US']]);
        const port = await deadPort();
        await write(
            'engines:\n  harper: true\n  languagetool:\n    enabled: true\n' +
            `    url: "http://127.0.0.1:${port}"\n  spell_language: "en-US"\n`,
        );
        await marked('engines.languagetool', 'down');

        // Typed, not saved. The engines go on running under the config on
        // disk -- that is what configEdits pins -- but the marks are about
        // the text on screen, or the feedback arrives after the mistake has
        // been committed.
        const editor = await vscode.window.showTextDocument(configDocument, { preview: false });
        const broken = configDocument.getText().indexOf(`http://127.0.0.1:${port}`);
        assert.ok(broken > 0, 'the url is in the buffer');
        await editor.edit(edit => {
            edit.replace(
                new vscode.Range(
                    configDocument.positionAt(broken),
                    configDocument.positionAt(broken + `http://127.0.0.1:${port}`.length),
                ),
                url,
            );
        });
        assert.ok(configDocument.isDirty, 'the edit is unsaved');

        await marked('engines.languagetool', 'ok');
    });

    test('a linter name Harper does not have is squiggled and turns its block', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await write(
            'engines:\n  harper:\n    enabled: true\n    linters:\n' +
            '      LongSentance: false\n  spell_language: "en-US"\n',
        );

        const squiggle = await squiggleMatching(/no linter called/i);
        assert.ok(
            configDocument.getText(squiggle.range).includes('LongSentance'),
            'the squiggle sits on the rule name',
        );
        // The block header carries the rollup, so the failure is visible
        // without expanding anything -- and it carries the reason with it. A
        // header that goes red and then explains itself with "Harper is built
        // in and always available" is worse than no hover at all.
        const header = await marked('engines.harper', 'down');
        assert.ok(
            header.details.some(d => /no linter called/i.test(d)),
            `the header hover should say why it is red: ${JSON.stringify(header.details)}`,
        );
    });

    test('a real linter name produces no complaint', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await write(
            'engines:\n  harper:\n    enabled: true\n    linters:\n' +
            '      LongSentences: false\n  spell_language: "en-US"\n',
        );
        await marked('engines.harper', 'ok');
        await noSquiggleMatching(/no linter called/i);
    });

    test('a key that is not a setting is squiggled but earns no mark', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await write(
            'engines:\n  harper: true\n  spell_langauge: "en-US"\n',
        );

        const squiggle = await squiggleMatching(/is not a setting/i);
        assert.ok(
            configDocument.getText(squiggle.range).includes('spell_langauge'),
            'the squiggle sits on the misspelled key',
        );
        // The distinction the whole design rests on: this was decidable from
        // the text, so it gets no tick and no cross.
        assert.strictEqual(
            await markFor('engines.spell_langauge'),
            undefined,
            'a text-decidable finding earns no gutter mark',
        );
    });

    test('a language nothing enabled can check is reported against spell_language', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // Harper reads English only, so this workspace is configured to check
        // nothing -- which otherwise produces a clean document and no
        // explanation at all.
        await write('engines:\n  harper: true\n  spell_language: "de-DE"\n');

        await marked('engines.spell_language', 'down');
        const squiggle = await squiggleMatching(/Nothing enabled here checks/i);
        assert.ok(configDocument.getText(squiggle.range).includes('de-DE'));
    });

    test('a vale config that is not there is reported against the path', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await write(
            'engines:\n  harper: true\n  vale:\n    enabled: true\n' +
            '    config: "no-such-file.ini"\n  spell_language: "en-US"\n',
        );

        // Vale may or may not be installed on the machine running this. Both
        // outcomes are a failure on this config and both belong on the block;
        // which one it is depends on the box, so the assertion is on the mark
        // and not on the sentence.
        await marked('engines.vale', 'down');
        const squiggle = await squiggleMatching(/no-such-file\.ini|not on PATH/i);
        assert.strictEqual(squiggle.severity, vscode.DiagnosticSeverity.Error);
    });

    test('a duplicate engine block discards the whole config, and says so', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The README documents both `harper: true` and the nested block, so
        // this is the mistake the docs themselves invite. It is not the
        // "last one wins" that YAML readers usually do: the core parses with
        // serde, which rejects a duplicate outright, and a config that fails
        // to load falls back to the defaults in full. One repeated key
        // therefore throws away every setting in the file.
        await write(
            'engines:\n  harper: true\n  harper:\n    enabled: true\n  spell_language: "en-US"\n',
        );

        const squiggle = await squiggleMatching(/unique/i);
        assert.match(squiggle.message, /falls back to its default/);
        assert.ok(
            configDocument.getText(squiggle.range).includes('harper'),
            'the squiggle sits on the repeated key',
        );
        // The core could not load it either, which is the half that says the
        // settings are gone rather than merely doubled.
        await eventually(
            'the core to report the config as unloadable',
            async () => ((await snapshot())?.parseError ?? '') !== '' ? true : undefined,
            BUDGET_MS,
        );

        // And it recovers on the next valid save.
        await write(originalConfig);
        await marked('engines.harper', 'ok');
    });

    test('a config that will not parse says so without losing the connection', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await write('engines:\n  harper: true\n   bad_indent: 1\n');
        await squiggleMatching(/.+/);

        // And it recovers: the next valid save is marked as usual.
        await write(originalConfig);
        await marked('engines.harper', 'ok');
    });
});
