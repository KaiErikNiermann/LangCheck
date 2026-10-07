// "Fix all" replaces a misspelled word wherever it was found, through the
// client's DiagnosticActions on the shim. It must edit only by ranges that
// still hold the text they were found at, apply all or nothing, and drop
// findings only for an edit that applied.
import { expect, test } from 'vitest';
import { uriKey } from '../../../extension/src/shared/documents';
import type { Diagnostic } from '../../src/shim/vscode';
import { fakeEditor, finding, open, setup } from './clientFakes';

test('every occurrence is replaced once, even where two engines flagged it, and the other findings stay', async () => {
    const { store, actions } = setup();
    const editor = fakeEditor('test:/a.md', 'a teh b teh c');
    const doc = open(editor);
    const grammar = finding(doc, 0, 1, 'grammar.article');
    store.publishCheck(doc.uri, [finding(doc, 2, 5, 'harper.Spelling'), finding(doc, 2, 5, 'MORFOLOGIK_RULE_EN_US'), finding(doc, 8, 11, 'harper.Spelling'), grammar], doc.version);
    await actions.fixAllSpelling('teh', 'the', uriKey(doc.uri));
    expect(editor.text()).toBe('a the b the c');
    expect(store.get(uriKey(doc.uri))).toEqual([grammar]);
});

test('a document typed into since its check is not edited, and is re-checked', async () => {
    const { store, check, actions } = setup();
    const editor = fakeEditor('test:/b.md', 'a teh b');
    const doc = open(editor);
    store.publishCheck(doc.uri, [finding(doc, 2, 5, 'harper.Spelling')], doc.version);
    // The user types "teh" before it (say, into a macro name): the stale
    // range 2..5 holds the typed text, which reads as the word.
    editor.type(2, 'teh');
    await actions.fixAllSpelling('teh', 'the');
    expect(editor.text()).toBe('a tehteh b');
    expect(check).toHaveBeenCalledWith(doc);
});

test('an edit the editor refused keeps the findings', async () => {
    const { store, actions } = setup();
    const editor = fakeEditor('test:/c.md', 'a teh b');
    const doc = open(editor);
    const list = [finding(doc, 2, 5, 'harper.Spelling')];
    store.publishCheck(doc.uri, list, doc.version);
    editor.refuse = true;
    await actions.fixAllSpelling('teh', 'the');
    expect(editor.text()).toBe('a teh b');
    expect(store.get(uriKey(doc.uri))).toBe(list);
});

test('a check that lands during the edit is not overwritten by the list the edit started from', async () => {
    const { store, actions } = setup();
    let landed: Diagnostic[] = [];
    const editor = fakeEditor('test:/d.md', 'a teh b', () => {
        landed = [finding(doc, 0, 1, 'grammar.article')];
        store.publishCheck(doc.uri, landed, doc.version);
    });
    const doc = open(editor);
    store.publishCheck(doc.uri, [finding(doc, 2, 5, 'harper.Spelling')], doc.version);
    await actions.fixAllSpelling('teh', 'the', uriKey(doc.uri));
    expect(editor.text()).toBe('a the b');
    expect(store.get(uriKey(doc.uri))).toBe(landed);
});
