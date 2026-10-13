// @vitest-environment happy-dom
// The card is shown again on every hover and every recheck; whatever it
// installs per show must not pile up.
import { expect, test, vi } from 'vitest';
import { Popover, type PopoverSurface } from '../../src/editor/popover';

function fakeSurface(): PopoverSurface {
    const mount = document.createElement('div');
    document.body.append(mount);
    return {
        mount,
        toastMount: mount,
        place: () => ({ top: 10, left: 10 }),
        measure: (read, write) => {
            write(read());
        },
        focusEditor: () => {},
    };
}

test('Escape dismisses only the card that is showing, however often it was shown', () => {
    const popover = new Popover(fakeSurface());
    const dismissals = Array.from({ length: 5 }, () => vi.fn());
    const content = { message: 'm', origin: undefined, paragraphs: [], actions: [{ title: 'a', kind: 'fix' as const, run: () => {} }] };
    for (const onDismiss of dismissals) popover.show(0, content, { focus: false, onDismiss });
    const card = document.querySelector('.lc-popover')!;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismissals.at(-1)).toHaveBeenCalledTimes(1);
    const earlier = dismissals.slice(0, -1);
    for (const dismiss of earlier) expect(dismiss).not.toHaveBeenCalled();
});

test('actions are rows tagged with their kind, the glyph kept out of their names', () => {
    document.body.replaceChildren();
    const popover = new Popover(fakeSurface());
    const actions = [
        { title: 'Fix: "the"', kind: 'preferred' as const, run: () => {} },
        { title: 'Ignore this issue', kind: 'ignore' as const, run: () => {} },
    ];
    popover.show(0, { message: 'm', origin: 'language-check(harper.SpellCheck)', paragraphs: [], actions }, { focus: false, onDismiss: () => {} });
    const card = document.querySelector('.lc-popover:not([hidden])')!;
    expect(card.querySelector('.lc-origin')?.textContent).toBe('language-check(harper.SpellCheck)');
    const rows = [...card.querySelectorAll<HTMLButtonElement>(':scope .lc-actions > .lc-action')];
    expect(rows.map((b) => [b.dataset['kind'], b.textContent])).toEqual([
        ['preferred', 'Fix: "the"'],
        ['ignore', 'Ignore this issue'],
    ]);
    for (const b of rows) expect(b.querySelector('.lc-glyph')?.getAttribute('aria-hidden')).toBe('true');
});
