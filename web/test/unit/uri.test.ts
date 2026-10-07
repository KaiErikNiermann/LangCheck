// The shim's Uri against VS Code's contract: a decoded path, a string form
// that parses back to the same Uri.
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { basename } from '../../../extension/src/shared/paths';
import { Uri } from '../../src/shim/vscode';

test('the path is decoded, so a file name reads as itself', () => {
    const uri = Uri.parse('overleaf:/p1/doc-main%2Fmy%20doc.md');
    expect(uri.path).toBe('/p1/doc-main/my doc.md');
    expect(basename(uri.path)).toBe('my doc.md');
});

test('a lone surrogate in a name is replaced, not thrown on', () => {
    expect(Uri.joinPath(Uri.parse('typst:/p1'), 'a\u{D800}b').toString()).toBe('typst:/p1/a%EF%BF%BDb');
});

test('a malformed escape is kept as written', () => {
    expect(Uri.parse('overleaf:/p1/100%.md').path).toBe('/p1/100%.md');
});

test('toString parses back to the same Uri, whatever the path holds', () => {
    fc.assert(
        fc.property(fc.array(fc.string({ unit: 'binary' }), { minLength: 1, maxLength: 4 }), (segments) => {
            const uri = Uri.joinPath(Uri.parse('typst:/p1'), ...segments);
            const again = Uri.parse(uri.toString());
            expect(again.path).toBe(uri.path);
            expect(again.toString()).toBe(uri.toString());
        }),
    );
});

test('a link keeps its query and fragment as written', () => {
    const link = 'https://github.com/KaiErikNiermann/LangCheck/issues/new?title=Inspector%20bug%20report&body=a%26b#top';
    const uri = Uri.parse(link);
    expect(uri.path).toBe('//github.com/KaiErikNiermann/LangCheck/issues/new');
    expect(uri.query).toBe('title=Inspector%20bug%20report&body=a%26b');
    expect(uri.fragment).toBe('top');
    expect(uri.toString()).toBe(link);
});

test('a file name holding ? or # is a name, not a query', () => {
    const uri = Uri.joinPath(Uri.parse('overleaf:/p1'), 'what?#1.tex');
    expect(Uri.parse(uri.toString()).path).toBe('/p1/what?#1.tex');
});

