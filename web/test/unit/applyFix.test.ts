// After a fix, the other findings move over it and stay actionable, but only
// when the text is exactly what the fix made: moved over a change that was
// not the fix, a range marks other text, and a second fix edits there.
import { expect, test } from 'vitest';
import { uriKey } from '../../../extension/src/shared/documents';
import { fakeEditor, finding, open, setup } from './clientFakes';

test('the second finding stays actionable after a fix that landed as made', async () => {
    const { store, actions } = setup();
    const editor = fakeEditor('test:/fix.md', 'teh cat teh');
    const doc = open(editor);
    store.publishCheck(doc.uri, [finding(doc, 0, 3, 'harper.Spelling'), finding(doc, 8, 11, 'harper.Spelling')], doc.version);
    await actions.applyFix(store.idOf(uriKey(doc.uri), 0), 'the');
    await actions.applyFix(store.idOf(uriKey(doc.uri), 0), 'the');
    expect(editor.text()).toBe('the cat the');
});

test('a fix that changed more than it said leaves the rest waiting for the re-check', async () => {
    const { store, check, actions } = setup();
    const editor = fakeEditor('test:/fix2.md', 'teh cat teh');
    const doc = open(editor);
    store.publishCheck(doc.uri, [finding(doc, 0, 3, 'harper.Spelling'), finding(doc, 8, 11, 'harper.Spelling')], doc.version);
    // Something on the page writes before the text in the same step.
    editor.alsoChange = (text) => `Well, ${text}`;
    await actions.applyFix(store.idOf(uriKey(doc.uri), 0), 'the');
    editor.alsoChange = undefined;
    expect(editor.text()).toBe('Well, the cat teh');
    expect(store.isCurrent(doc)).toBe(false);
    // A fix by the moved id is refused: it re-checks instead of editing
    // (moved by the fix alone, the range would hold "e c").
    check.mockClear();
    await actions.applyFix(store.idOf(uriKey(doc.uri), 0), 'the');
    expect(editor.text()).toBe('Well, the cat teh');
    expect(check).toHaveBeenCalledWith(doc);
});
