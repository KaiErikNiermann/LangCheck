// Panel messages from the page world: only the four operations, on a panel
// id of the agreed shape, for a view type the web has, within the size cap.
import { describe, expect, test } from 'vitest';
import { MAX_PANEL_MESSAGE_CHARS, parsePageToPanel, parsePanelToPage, WEBVIEW_TYPE } from '../../src/messaging/webview';
import { PALETTE } from '../../src/palette/commands';
import { WEB_COMMANDS } from '../../src/page/client';

describe('parsePageToPanel', () => {
    test('accepts each operation, rebuilt from its own fields', () => {
        expect(parsePageToPanel({ type: WEBVIEW_TYPE, op: 'open', panel: 'p1', viewType: 'inspector', extra: 1 })).toEqual({ type: WEBVIEW_TYPE, op: 'open', panel: 'p1', viewType: 'inspector' });
        expect(parsePageToPanel({ type: WEBVIEW_TYPE, op: 'post', panel: 'p1', message: { a: [1] } })).toEqual({ type: WEBVIEW_TYPE, op: 'post', panel: 'p1', message: { a: [1] } });
        expect(parsePageToPanel({ type: WEBVIEW_TYPE, op: 'reveal', panel: 'p1' })).toEqual({ type: WEBVIEW_TYPE, op: 'reveal', panel: 'p1' });
        expect(parsePageToPanel({ type: WEBVIEW_TYPE, op: 'close', panel: 'p1' })).toEqual({ type: WEBVIEW_TYPE, op: 'close', panel: 'p1' });
        expect(parsePageToPanel({ type: WEBVIEW_TYPE, op: 'focusEditor', panel: '../x' })).toEqual({ type: WEBVIEW_TYPE, op: 'focusEditor' });
    });

    const big = 'x'.repeat(MAX_PANEL_MESSAGE_CHARS);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    test.each([
        ['another type', { type: 'command', op: 'open', panel: 'p1', viewType: 'speedFix' }],
        ['an unknown op', { type: WEBVIEW_TYPE, op: 'navigate', panel: 'p1' }],
        ['an unknown view type', { type: WEBVIEW_TYPE, op: 'open', panel: 'p1', viewType: 'configStatus' }],
        ['a view type from the prototype', { type: WEBVIEW_TYPE, op: 'open', panel: 'p1', viewType: 'toString' }],
        ['a panel id with a path in it', { type: WEBVIEW_TYPE, op: 'close', panel: '../p1' }],
        ['a panel id with a colon (the background key separator)', { type: WEBVIEW_TYPE, op: 'close', panel: '7:p1' }],
        ['an empty panel id', { type: WEBVIEW_TYPE, op: 'close', panel: '' }],
        ['a long panel id', { type: WEBVIEW_TYPE, op: 'close', panel: 'p'.repeat(41) }],
        ['a message over the cap', { type: WEBVIEW_TYPE, op: 'post', panel: 'p1', message: big }],
        ['a cyclic message', { type: WEBVIEW_TYPE, op: 'post', panel: 'p1', message: cyclic }],
        ['no message', { type: WEBVIEW_TYPE, op: 'post', panel: 'p1' }],
        ['an array', [WEBVIEW_TYPE]],
        ['null', null],
    ])('refuses %s', (_name, value) => {
        expect(parsePageToPanel(value)).toBeUndefined();
    });
});

describe('parsePanelToPage', () => {
    test('accepts a message and a close, and nothing else', () => {
        expect(parsePanelToPage({ type: WEBVIEW_TYPE, op: 'message', panel: 'p2', message: 1 })).toEqual({ type: WEBVIEW_TYPE, op: 'message', panel: 'p2', message: 1 });
        expect(parsePanelToPage({ type: WEBVIEW_TYPE, op: 'closed', panel: 'p2' })).toEqual({ type: WEBVIEW_TYPE, op: 'closed', panel: 'p2' });
        expect(parsePanelToPage({ type: WEBVIEW_TYPE, op: 'open', panel: 'p2' })).toBeUndefined();
        expect(parsePanelToPage({ type: WEBVIEW_TYPE, op: 'closed', panel: 'P 2' })).toBeUndefined();
    });
});

test('every palette command is one the page registers', () => {
    expect(PALETTE.filter((entry) => !WEB_COMMANDS.has(entry.id))).toEqual([]);
});
