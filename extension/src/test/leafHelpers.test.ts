import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { byteToCharConverter } from '../checking/offsets';
import { proseMetrics } from '../ui/readability';
import { webviewHtml } from '../ui/webviews/html';

describe('byteToCharConverter', () => {
    it('is the identity on ASCII', () => {
        const toChar = byteToCharConverter('hello world');
        expect([0, 5, 11].map(toChar)).toEqual([0, 5, 11]);
    });

    it('counts multi-byte characters as their UTF-16 length', () => {
        // é is 2 bytes and 1 unit; 😀 is 4 bytes and 2 units.
        const toChar = byteToCharConverter('é😀x');
        expect(toChar(2)).toBe(1);
        expect(toChar(6)).toBe(3);
        expect(toChar(7)).toBe(4);
    });

    it('counts a cut through a character as one replacement unit, as Buffer does', () => {
        expect(byteToCharConverter('é')(1)).toBe(1);
    });
});

describe('proseMetrics', () => {
    it('measures words, sentences and characters', () => {
        expect(proseMetrics('The cat sat. It was happy!')).toMatchObject({
            wordCount: 6,
            sentenceCount: 2,
            charCount: 19,
        });
    });

    it('gives the ARI for the counts', () => {
        const m = proseMetrics('The cat sat. It was happy!');
        expect(m.readingLevel).toBeCloseTo(4.71 * (19 / 6) + 0.5 * (6 / 2) - 21.43);
    });

    it('reports nothing for empty prose', () => {
        expect(proseMetrics('')).toEqual({ wordCount: 0, sentenceCount: 0, charCount: 0, readingLevel: 0 });
    });

    it('counts a last sentence with no closing punctuation', () => {
        expect(proseMetrics('no punctuation here').sentenceCount).toBe(1);
    });
});

describe('webviewHtml', () => {
    const webview = { asWebviewUri: (uri: { path: string }) => `vscode-resource:${uri.path}` } as unknown as vscode.Webview;

    it('is the page the SpeedFix panel loaded before it was shared', () => {
        expect(webviewHtml(webview, '/ext', { script: 'index', title: 'SpeedFix' })).toBe(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="vscode-resource:/ext/webview/dist/assets/index.css">
    <title>SpeedFix</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="vscode-resource:/ext/webview/dist/assets/index.js"></script>
</body>
</html>`);
    });

    it('points the Inspector at its own entry', () => {
        const html = webviewHtml(webview, '/ext', { script: 'inspector', title: 'Inspector' });
        expect(html).toContain('assets/inspector.js');
        expect(html).toContain('assets/inspector.css');
        expect(html).toContain('<title>Inspector</title>');
    });
});
