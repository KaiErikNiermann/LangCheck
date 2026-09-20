/**
 * What silences a word, and what brings it back.
 *
 * `rust-core/tests/morphology_precision.rs` holds these invariants against the
 * suppression pass directly. These hold them where a user meets them: a
 * document in an editor, a setting toggled, and the squiggles that appear or
 * disappear as a result. The two layers can disagree -- a setting that never
 * reaches the core looks exactly like a feature that works -- and only this
 * one would notice.
 *
 * Every word in the fixture was measured against the real dictionaries before
 * being written down, so a failure here is a behaviour change and not a guess
 * that went stale.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

/** Carried by a bundled wordlist, and by nothing else. */
const FROM_A_WORDLIST = ['libpcap', 'synology'];
/**
 * Carried by a wordlist *and* reachable by morphology, so switching off either
 * one alone leaves it accepted. Kept apart from the list above because a test
 * that expected it back when only the wordlists went off would be wrong about
 * the code rather than the other way round.
 */
const BELT_AND_BRACES = 'cofiltered';
/** Carried by the `companies` list specifically. */
const FROM_COMPANIES = 'synology';
/** Accepted because they decompose into a root the dictionary knows. */
const FROM_MORPHOLOGY = ['preimage', 'metavariable'];
/** A prefix on an unknown root. Nothing may ever accept these. */
const NEVER_A_WORD = ['subxyzzy', 'quasiblorp', 'nonfrobnitz'];
/** An ordinary misspelling, reported under every configuration. */
const CONTROL = 'recieve';

/** The words this document currently has a spelling diagnostic on. */
function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri)
            .filter(d => typeof d.code === 'string' && /spell/i.test(d.code))
            .map(d => document.getText(d.range).toLowerCase()),
    );
}

/**
 * Wait until the flagged set satisfies `want`.
 *
 * A setting change tears the client down and re-checks, so the document passes
 * through having no diagnostics at all. Polling the condition rather than
 * reading once is what stops a test passing on that empty moment.
 */
async function settlesTo(
    document: vscode.TextDocument,
    what: string,
    want: (words: Set<string>) => boolean,
): Promise<Set<string>> {
    return eventually(
        what,
        () => {
            const words = flagged(document);
            return want(words) ? words : undefined;
        },
        BUDGET_MS,
    );
}

suite('dictionaries and morphology', () => {
    let document: vscode.TextDocument;
    let originalConfigYaml: string;
    let configUri: vscode.Uri;

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        document = await openInEditor(fixture('words.md'));
        configUri = fixture('.languagecheck.yaml');
        originalConfigYaml = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        // Settings and the workspace config both persist into the next test,
        // and a leftover one would make a result depend on the order things
        // ran in. Restored even when a test failed part-way.
        const config = vscode.workspace.getConfiguration('languageCheck');
        await config.update('dictionaries.bundled', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('dictionaries.disabled', undefined, vscode.ConfigurationTarget.Workspace);
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfigYaml, 'utf8'));

        // And waited for. Restoring a setting starts a re-check that the next
        // test would otherwise race: two configurations can share a symptom --
        // `synology` is reported both with every wordlist off and with only
        // `companies` off -- so a test waiting on that symptom can settle on
        // the previous test's state and then assert against the wrong one.
        await settlesTo(
            document,
            'the baseline to be restored before the next test',
            found =>
                !FROM_A_WORDLIST.some(w => found.has(w))
                && !FROM_MORPHOLOGY.some(w => found.has(w))
                && found.has(CONTROL),
        );
    });

    test('out of the box, only the non-words are reported', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The sanity check the rest rests on: if this passed with everything
        // flagged, or with nothing flagged, none of the toggles below would
        // mean anything.
        const words = await settlesTo(
            document,
            'the control misspelling to be reported',
            found => found.has(CONTROL),
        );

        for (const word of NEVER_A_WORD) {
            assert.ok(words.has(word), `${word} is not a word and was not reported`);
        }
        for (const word of [...FROM_A_WORDLIST, ...FROM_MORPHOLOGY, BELT_AND_BRACES]) {
            assert.ok(!words.has(word), `${word} should have been accepted, and was reported`);
        }
    });

    test('turning the bundled wordlists off brings their words back', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.getConfiguration('languageCheck')
            .update('dictionaries.bundled', false, vscode.ConfigurationTarget.Workspace);

        const words = await settlesTo(
            document,
            'the wordlist words to be reported once the lists are off',
            found => FROM_A_WORDLIST.every(w => found.has(w)),
        );

        // And the setting must not have silenced everything else by taking the
        // core down: the control is still reported, so a check still ran.
        assert.ok(words.has(CONTROL), 'nothing was checked at all');

        // Morphology is untouched, so what it reaches stays accepted.
        assert.ok(
            !words.has(BELT_AND_BRACES),
            `${BELT_AND_BRACES} decomposes, so morphology should still accept it`,
        );
    });

    test('turning off one wordlist affects only that list', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.getConfiguration('languageCheck')
            .update('dictionaries.disabled', ['companies'], vscode.ConfigurationTarget.Workspace);

        const words = await settlesTo(
            document,
            'the companies entry to be reported',
            found => found.has(FROM_COMPANIES),
        );

        // `libpcap` is in jargon, which is still on. Without this the test
        // would pass just as well if `disabled` switched every list off.
        assert.ok(
            !words.has('libpcap'),
            'disabling one list disabled another: libpcap is in jargon, not companies',
        );
    });

    test('morphology is what accepts a coined word, not a wordlist', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // No VS Code setting reaches morphology, so this goes through the
        // workspace config -- which also exercises the file watcher that is
        // meant to pick a config edit up.
        await vscode.workspace.fs.writeFile(
            configUri,
            Buffer.from(
                'engines:\n  harper: true\nmorphology:\n  enabled: false\n  inflections: false\n',
                'utf8',
            ),
        );

        const words = await settlesTo(
            document,
            'the coined words to be reported once morphology is off',
            found => FROM_MORPHOLOGY.every(w => found.has(w)),
        );

        // The bundled lists are untouched, so their words stay accepted. That
        // is what makes this a test of morphology and not of the dictionary.
        assert.ok(
            !words.has('libpcap'),
            'switching morphology off also lost the bundled wordlists',
        );
    });

    test('adding a word makes the core accept it, and says so on disk', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // Two things have to be true and only one of them is visible. The
        // squiggle going away could be the editor removing it optimistically,
        // which it does before the core has answered; the word appearing in
        // the workspace dictionary is the core having actually taken it.
        const dictionaryFile = fixture('.languagecheck/dictionary.txt');
        await settlesTo(
            document,
            'the word to be reported before it is added',
            found => found.has('subxyzzy'),
        );

        try {
            await vscode.commands.executeCommand('language-check.addToDictionary', 'subxyzzy');

            await settlesTo(
                document,
                'the added word to stop being reported',
                found => !found.has('subxyzzy'),
            );

            const written = Buffer.from(
                await vscode.workspace.fs.readFile(dictionaryFile),
            ).toString('utf8');
            assert.ok(
                written.split(/\r?\n/).some(line => line.trim() === 'subxyzzy'),
                `the core did not record the word; the file holds: ${JSON.stringify(written)}`,
            );

            // Its neighbours are untouched: adding one word must not be a way
            // of switching spelling off.
            const words = flagged(document);
            assert.ok(words.has('quasiblorp'), 'adding one word silenced another');
            assert.ok(words.has(CONTROL), 'adding one word silenced the control');
        } finally {
            // The fixture is committed, so the directory the core created goes.
            await vscode.workspace.fs.delete(fixture('.languagecheck'), {
                recursive: true,
                useTrash: false,
            }).then(undefined, () => undefined);
        }
    });

    test('a prefix never rescues an unknown root, under any configuration', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The hard gate from morphology_precision.rs, where relaxing it is not
        // an option: a real misspelling that stops being reported costs the
        // user their trust in every remaining squiggle.
        await vscode.workspace.fs.writeFile(
            configUri,
            Buffer.from('engines:\n  harper: true\nmorphology:\n  enabled: true\n  inflections: true\n', 'utf8'),
        );

        const words = await settlesTo(
            document,
            'the non-words to stay reported with morphology at its most permissive',
            found => NEVER_A_WORD.every(w => found.has(w)),
        );
        assert.ok(words.has(CONTROL), 'the control stopped being reported');
    });
});
