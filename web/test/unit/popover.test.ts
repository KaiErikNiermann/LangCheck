// @vitest-environment happy-dom
// The card is shown again on every hover and every recheck; whatever it
// installs per show must not pile up.
import { expect, test, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { Popover } from '../../src/editor/popover';

function fakeView(): EditorView {
    const scrollDOM = document.createElement('div');
    const dom = document.createElement('div');
    dom.append(scrollDOM);
    document.body.append(dom);
    return {
        dom,
        scrollDOM,
        state: { doc: { length: 100 } },
        coordsAtPos: () => ({ left: 10, right: 20, top: 10, bottom: 20 }),
        focus: () => {},
        requestMeasure: () => {},
    } as unknown as EditorView;
}

test('Escape dismisses only the card that is showing, however often it was shown', () => {
    const popover = new Popover(fakeView());
    const dismissals = Array.from({ length: 5 }, () => vi.fn());
    const content = { message: 'm', paragraphs: [], actions: [{ title: 'a', run: () => {} }] };
    for (const onDismiss of dismissals) popover.show(0, content, { focus: false, onDismiss });
    const card = document.querySelector('.lc-popover')!;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismissals.at(-1)).toHaveBeenCalledTimes(1);
    const earlier = dismissals.slice(0, -1);
    for (const dismiss of earlier) expect(dismiss).not.toHaveBeenCalled();
});
