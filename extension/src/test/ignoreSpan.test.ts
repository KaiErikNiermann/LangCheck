/**
 * Which diagnostics a selection means.
 *
 * The dangerous direction is reaching too far: silencing a finding the user
 * did not select is a suppression they never asked for and will not think to
 * look for.
 */
import { describe, expect, it } from 'vitest';

import { engines, spanned, touches } from '../shared/ignoreSpan';

const at = (start: number, end: number) => ({ start, end });

describe('touches', () => {
    it('reaches a diagnostic the caret sits inside', () => {
        expect(touches(at(5, 5), at(3, 8))).toBe(true);
    });

    it('reaches a diagnostic the caret sits at the start of', () => {
        expect(touches(at(3, 3), at(3, 8))).toBe(true);
    });

    it('does not reach the diagnostic a caret merely abuts at the end', () => {
        // The caret after `word` belongs to whatever follows it, not to
        // `word` -- otherwise one keystroke silences two findings.
        expect(touches(at(8, 8), at(3, 8))).toBe(false);
    });

    it('reaches every diagnostic a selection crosses', () => {
        expect(touches(at(4, 12), at(3, 8))).toBe(true);
        expect(touches(at(4, 12), at(10, 20))).toBe(true);
    });

    it('does not reach a diagnostic the selection only abuts', () => {
        expect(touches(at(8, 12), at(3, 8))).toBe(false);
        expect(touches(at(3, 8), at(8, 12))).toBe(false);
    });

    it('reaches a zero-width diagnostic inside the selection', () => {
        // A missing-word finding has no text of its own.
        expect(touches(at(3, 9), at(5, 5))).toBe(true);
        expect(touches(at(3, 9), at(9, 9))).toBe(false);
    });
});

describe('spanned', () => {
    const diagnostics = [
        { start: 10, end: 14, code: 'harper.Spelling' },
        { start: 3, end: 8, code: 'languagetool.MORFOLOGIK_RULE_EN_US' },
        { start: 30, end: 36, code: 'vale.Vale.Spelling' },
        { start: 3, end: 8, code: 'vale.Vale.Spelling' },
    ];

    it('returns every engine that dislikes the same phrase', () => {
        const hit = spanned(at(3, 8), diagnostics);
        expect(hit.map(d => d.code)).toEqual([
            'languagetool.MORFOLOGIK_RULE_EN_US',
            'vale.Vale.Spelling',
        ]);
    });

    it('returns them in document order', () => {
        const hit = spanned(at(0, 40), diagnostics);
        expect(hit.map(d => d.start)).toEqual([3, 3, 10, 30]);
    });

    it('returns nothing for a selection that reaches none', () => {
        expect(spanned(at(20, 25), diagnostics)).toEqual([]);
    });
});

describe('engines', () => {
    it('counts the distinct providers behind a set of rule ids', () => {
        expect(engines(['harper.Spelling', 'harper.Style', 'vale.Vale.Spelling']))
            .toEqual(new Set(['harper', 'vale']));
    });

    it('ignores a diagnostic with no rule id', () => {
        expect(engines([undefined, '', 'harper.Spelling'])).toEqual(new Set(['harper']));
    });
});
