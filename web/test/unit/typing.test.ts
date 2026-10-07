// @vitest-environment happy-dom
// What the palette keeps from keys typed while it opens, and that holding
// the keyboard really keeps them from everything else listening.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { applyTyped, holdKeys, isBinding, MAX_TYPED_CHARS, typedKey } from '../../src/palette/typing';

const key = (k: string, mods: { code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean } = {}) => ({ key: k, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods });

describe('typedKey', () => {
    test.each([
        ['a', key('a'), { kind: 'char', char: 'a' }],
        ['an astral character', key('😀'), { kind: 'char', char: '😀' }],
        ['AltGr text (Alt is allowed)', key('@', { altKey: true }), { kind: 'char', char: '@' }],
        ['Backspace', key('Backspace'), { kind: 'backspace' }],
        ['Escape', key('Escape'), { kind: 'close' }],
        ['Ctrl+a', key('a', { ctrlKey: true }), { kind: 'other' }],
        ['Meta+a', key('a', { metaKey: true }), { kind: 'other' }],
        ['a named key', key('ArrowDown'), { kind: 'other' }],
        ['composition', key('a', { isComposing: true }), { kind: 'other' }],
    ])('%s', (_name, event, expected) => {
        expect(typedKey(event)).toEqual(expected);
    });
});

describe('isBinding', () => {
    test.each([
        ['ctrl+p', key('p', { code: 'KeyP', ctrlKey: true }), true],
        ['ctrl+p, with Shift held, is another binding', key('P', { code: 'KeyP', ctrlKey: true, shiftKey: true }), false],
        ['ctrl+shift+l', key('L', { code: 'KeyL', ctrlKey: true, shiftKey: true }), true],
        ['ctrl+p on another layout (the P key types π)', key('π', { code: 'KeyP', ctrlKey: true }), true],
        ['ctrl+p without Ctrl', key('p', { code: 'KeyP' }), false],
        ['ctrl+p with Alt as well', key('p', { code: 'KeyP', ctrlKey: true, altKey: true }), false],
        ['cmd+k,ctrl+k (the second)', key('k', { code: 'KeyK', ctrlKey: true }), true],
        ['ctrl+f5', key('F5', { code: 'F5', ctrlKey: true }), true],
        ['ctrl+banana (no such modifier)', key('p', { code: 'KeyP', ctrlKey: true }), false],
        ['ctrl+ (no key)', key('p', { code: 'KeyP', ctrlKey: true }), false],
    ])('%s', (name, event, expected) => {
        const binding = name.split(' ', 1)[0] ?? '';
        expect(isBinding(binding === 'ctrl+banana' ? 'ctrl+banana+p' : binding, event)).toBe(expected);
    });

    test('the binding closes, as Escape does', () => {
        expect(typedKey(key('p', { code: 'KeyP', ctrlKey: true }), 'ctrl+p')).toEqual({ kind: 'close' });
    });
});

describe('applyTyped', () => {
    test('backspace removes a whole astral character', () => {
        expect(applyTyped('a😀', { kind: 'backspace' })).toBe('a');
        expect(applyTyped('', { kind: 'backspace' })).toBe('');
    });

    test('never grows past the cap', () => {
        fc.assert(
            fc.property(fc.array(fc.oneof(fc.string({ minLength: 1, maxLength: 1 }).map((char) => ({ kind: 'char' as const, char })), fc.constant({ kind: 'backspace' as const }))), (keys) => {
                let text = '';
                for (const typed of keys) text = applyTyped(text, typed);
                expect(text.length).toBeLessThanOrEqual(MAX_TYPED_CHARS);
            }),
        );
    });
});

describe('holdKeys', () => {
    test('nothing in the page hears the keys, and the text is kept until release', () => {
        // The page's own listener, on an element: the hold on the window, in
        // the capture phase, runs first.
        const editor = document.createElement('div');
        document.body.append(editor);
        const heard: string[] = [];
        editor.addEventListener('keydown', (e) => {
            heard.push(e.key);
        });
        let escaped = 0;
        const hold = holdKeys(window, 'ctrl+p', () => {
            escaped++;
        });
        const press = (k: string): boolean => editor.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        expect(press('o')).toBe(false); // default prevented
        for (const k of ['p', 'Backspace', 'x', 'Escape']) press(k);
        expect(hold.typed()).toBe('ox');
        expect(escaped).toBe(1);
        expect(heard).toEqual([]);
        hold.release();
        press('z');
        expect(heard).toEqual(['z']);
        editor.remove();
    });

    test('Enter submits what was typed, and keys after it are dropped', () => {
        const hold = holdKeys(window, 'ctrl+p', () => {});
        for (const k of ['s', 'p', 'Enter', 'x']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        expect(hold.typed()).toBe('sp');
        expect(hold.submitted()).toBe(true);
        hold.release();
    });
});
