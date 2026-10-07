// "Ignore selection" asks the core to ignore each finding over the span, then
// drops them from the list it read before asking: only while that list is
// still the document's.
import { expect, test } from 'vitest';
import { diagnosticsCommands, type DiagnosticsCommandDeps } from '../../../extension/src/commands/diagnostics';
import { COMMANDS } from '../../../extension/src/commands/ids';
import { Suppression } from '../../../extension/src/diagnostics/store';
import { uriKey } from '../../../extension/src/shared/documents';
import type { Diagnostic } from '../../src/shim/vscode';
import { fakeEditor, finding, open, setup } from './clientFakes';

test('a check that lands while the core answers is not overwritten by the list from before it', async () => {
    const { store, check, actions, inspectorLog } = setup();
    const editor = fakeEditor('test:/ignore.md', 'a teh b');
    const doc = open(editor);
    store.publishCheck(doc.uri, [finding(doc, 2, 5, 'harper.Spelling')], doc.version);
    let landed: Diagnostic[] = [];
    const core = {
        client: {
            // The core answers after a check of the same text came back.
            sendRequest: () => {
                landed = [finding(doc, 0, 1, 'grammar.article')];
                store.publishCheck(doc.uri, landed, doc.version);
                return Promise.resolve({});
            },
        },
    };
    const commands = diagnosticsCommands({
        log: { debug: () => {}, error: () => {} },
        store,
        suppression: new Suppression(),
        inspectorLog,
        fixTarget: {} as DiagnosticsCommandDeps['fixTarget'],
        core: core as unknown as DiagnosticsCommandDeps['core'],
        checker: { check },
        actions,
        speedFix: { sendLoading: () => {}, reveal: () => {} },
    });
    await commands[COMMANDS.ignoreSelection](uriKey(doc.uri), 0, 7);
    expect(store.get(uriKey(doc.uri))).toBe(landed);
});
