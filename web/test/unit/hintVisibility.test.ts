// When the hints show, under each of VS Code's four editor.inlayHints.enabled values.
import { expect, test } from 'vitest';
import { hintsVisible } from '../../src/page/hintVisibility';

test.each([
    ['on', false, true],
    ['on', true, true],
    ['off', false, false],
    ['off', true, false],
    ['onUnlessPressed', false, true],
    ['onUnlessPressed', true, false],
    ['offUnlessPressed', false, false],
    ['offUnlessPressed', true, true],
] as const)('%s, Ctrl+Alt held: %s -> shown: %s', (mode, pressed, shown) => {
    expect(hintsVisible(mode, pressed)).toBe(shown);
});
