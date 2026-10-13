// @vitest-environment happy-dom
// A DOM editor leaves out a leaf that would pass the size cap whole, and
// Gmail's compose is one leaf: an over-long message is then not checked at
// all, which the page must say rather than show a clean message.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createDomAdapter } from '../../src/editor/domAdapter';
import { MAX_CHECK_TEXT_CHARS } from '../../src/messaging/protocol';

// happy-dom has no CSS Custom Highlight API; the adapter clears its highlights on dispose.
beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: new Map() });
});

afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function body(text: string): Element {
    const root = document.createElement('div');
    root.setAttribute('contenteditable', 'true');
    root.append(text);
    document.body.append(root);
    return root;
}

const rules = { leaves: (root: Element) => [root], isAtom: () => false };

test('a page too long to check whole says so, once', async () => {
    const editor = createDomAdapter(body('word '.repeat(MAX_CHECK_TEXT_CHARS / 4)), rules, 'gmail:/u0/compose-1', 'markdown');
    await flush();
    expect(editor.adapter.getText()).toBe('');
    const toasts = [...document.querySelectorAll('.lc-toast')].map((t) => t.textContent);
    expect(toasts).toEqual([`This page is too long for LangCheck to check whole: what comes after its first ${MAX_CHECK_TEXT_CHARS.toLocaleString('en')} characters is not checked.`]);
    editor.dispose();
});

test('a page within the cap says nothing', async () => {
    const editor = createDomAdapter(body('A short message.'), rules, 'gmail:/u0/compose-2', 'markdown');
    await flush();
    expect(editor.adapter.getText()).toBe('A short message.');
    expect(document.querySelectorAll('.lc-toast')).toHaveLength(0);
    editor.dispose();
});
