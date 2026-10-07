// @vitest-environment happy-dom
// The text a block editor's leaves give the checker, and the map back:
// every character that came from a text node must round-trip to the same
// character in the DOM, whatever the inline structure around it.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { ATOM, LEAF_SEPARATOR, buildTextMap, offsetOf, rangeOf } from '../../src/editor/domText';

const isAtom = (element: Element): boolean => element.getAttribute('contenteditable') === 'false' || element.classList.contains('code');

function leaves(...html: string[]): Element[] {
    document.body.innerHTML = html.map((h) => `<div class="leaf">${h}</div>`).join('');
    return [...document.querySelectorAll('.leaf')];
}

describe('buildTextMap', () => {
    test('reads text nodes, not textContent: atoms become one U+FFFC, breaks a newline, leaves a blank line', () => {
        const map = buildTextMap(
            leaves('plain <b>bold teh</b> <span contenteditable="false">e=mc2<span>e=mc^2</span></span> after', 'one<br>two', '<span class="code">x teh</span> end'),
            isAtom,
            1000,
        );
        expect(map.text).toBe(`plain bold teh ${ATOM} after${LEAF_SEPARATOR}one\ntwo${LEAF_SEPARATOR}${ATOM} end`);
        expect(map.truncated).toBe(false);
    });

    test('a leaf that would pass the cap is left out whole', () => {
        const map = buildTextMap(leaves('short', 'x'.repeat(50), 'after'), isAtom, 20);
        expect(map.text).toBe('short');
        expect(map.truncated).toBe(true);
    });

    test('a deeply nested leaf is walked without recursion', () => {
        const [leaf] = leaves('');
        let parent: Element = leaf!;
        for (let i = 0; i < 3000; i++) {
            const child = document.createElement('span');
            parent.append(child);
            parent = child;
        }
        parent.append('deep');
        expect(buildTextMap([leaf!], isAtom, 1000).text).toBe('deep');
        leaf!.replaceChildren();
    });
});

describe('rangeOf and offsetOf', () => {
    test('a word inside formatting maps to exactly that word, and back', () => {
        const map = buildTextMap(leaves('plain <b>bold <i>teh</i></b> after'), isAtom, 1000);
        const at = map.text.indexOf('teh');
        const range = rangeOf(map, at, at + 3)!;
        expect(range.toString()).toBe('teh');
        expect(offsetOf(map, range.startContainer, range.startOffset)).toBe(at);
    });

    test('a span crossing two leaves, or only covering an atom, has no range', () => {
        const map = buildTextMap(leaves('one', 'two <span contenteditable="false">eq</span>'), isAtom, 1000);
        expect(rangeOf(map, 0, map.text.length)).toBeUndefined();
        const atom = map.text.indexOf(ATOM);
        expect(rangeOf(map, atom, atom + 1)).toBeUndefined();
    });

    test('positions outside the text have no range', () => {
        const map = buildTextMap(leaves('abc'), isAtom, 1000);
        expect(rangeOf(map, -1, 2)).toBeUndefined();
        expect(rangeOf(map, 1, 9)).toBeUndefined();
        expect(rangeOf(map, 2, 2)).toBeUndefined();
    });

    test('any inline structure: every text-node character round-trips', () => {
        const word = fc.stringMatching(/^[a-zé😀 ]{1,6}$/u);
        const inline: fc.Arbitrary<string> = fc.letrec<{ node: string }>((tie) => ({
            node: fc.oneof(
                { depthSize: 'small', withCrossShrink: true },
                word,
                fc.constant('<span contenteditable="false">atom</span>'),
                fc.constant('<br>'),
                fc.tuple(fc.constantFrom('b', 'i', 'span'), fc.array(tie('node'), { maxLength: 3 })).map(([tag, kids]) => `<${tag}>${kids.join('')}</${tag}>`),
            ),
        })).node;
        fc.assert(
            fc.property(fc.array(fc.array(inline, { maxLength: 4 }).map((k) => k.join('')), { minLength: 1, maxLength: 3 }), (html) => {
                const map = buildTextMap(leaves(...html), isAtom, 10_000);
                for (const { node, start } of map.nodes) {
                    for (let i = 0; i < node.data.length; i++) {
                        const range = rangeOf(map, start + i, start + i + 1);
                        expect(range?.toString()).toBe(map.text[start + i]);
                        expect(offsetOf(map, node, i)).toBe(start + i);
                    }
                }
            }),
            { numRuns: 200 },
        );
    });
});
