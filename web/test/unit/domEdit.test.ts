// @vitest-environment happy-dom
// The DOM adapter types a fix in only where it can be sure the input lands
// on exactly the span the fix names (Notion's leaves).
import { expect, test } from 'vitest';
import { applyEdit } from '../../src/editor/domAdapter';
import { buildTextMap } from '../../src/editor/domText';
import type { TextEdit } from '../../src/editor/types';

const isAtom = (element: Element): boolean => element.getAttribute('contenteditable') === 'false';

function mapOf(html: string, editable = true) {
    document.body.innerHTML = `<div class="leaf" contenteditable="${String(editable)}">${html}</div>`;
    return buildTextMap(document.querySelectorAll('.leaf'), isAtom, 10_000);
}

const editOf = (text: string, from: number, to: number, insert: string): TextEdit => ({ from, to, insert, expectedAt: from, expected: text.slice(from, to) });

/** What a browser's insertText does to the selection, which happy-dom lacks. */
function typeInto(): void {
    // The deprecated API is the one the adapter types through: stubbed, not used.
    // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
    document.execCommand = (command: string, _ui?: boolean, value = '') => {
        const range = document.getSelection()?.getRangeAt(0);
        if (range === undefined) return false;
        range.deleteContents();
        if (command === 'insertText') range.insertNode(document.createTextNode(value));
        return true;
    };
}

test('control: a plain span passes every check and is typed in', () => {
    typeInto();
    const map = mapOf('one teh two');
    const reread = () => document.querySelector('.leaf')?.textContent ?? '';
    expect(applyEdit(map, editOf(map.text, 4, 7, 'the'), reread)).toBe(true);
    expect(reread()).toBe('one the two');
});

test('a span that holds an atom is refused, and the atom is kept', () => {
    typeInto();
    const map = mapOf('a <span contenteditable="false">x</span> b');
    expect(applyEdit(map, editOf(map.text, 0, 5, 'c'), () => map.text)).toBe(false);
    expect(document.querySelector('[contenteditable="false"]')?.textContent).toBe('x');
});

test('a line break in the replacement, which would split the block, is refused', () => {
    typeInto();
    const map = mapOf('one teh two');
    expect(applyEdit(map, editOf(map.text, 4, 7, 'the\nnext'), () => map.text)).toBe(false);
});

test('an empty deletion, which would be a Backspace on the character before, is refused', () => {
    typeInto();
    const map = mapOf('one two');
    expect(applyEdit(map, editOf(map.text, 3, 3, ''), () => map.text)).toBe(false);
    expect(document.querySelector('.leaf')?.textContent).toBe('one two');
});

test('a leaf that cannot be edited is not typed into', () => {
    typeInto();
    const map = mapOf('one teh two', false);
    expect(applyEdit(map, editOf(map.text, 4, 7, 'the'), () => map.text)).toBe(false);
});
