/**
 * Which config edits can skip the re-check.
 *
 * The cheap path is only sound while a change can do nothing but remove
 * diagnostics. Every case here is one that either is or is not, and the
 * dangerous direction is a change wrongly called subtractive: that leaves
 * findings on screen that the new config would have removed, or worse, omits
 * ones it would have added.
 */
import { describe, expect, it } from 'vitest';

import { classifyConfigChange, silencedBy } from '../configRules';

const BASE = 'engines:\n  harper: true\n  spell_language: "en-US"\n';

describe('classifyConfigChange', () => {
    it('reports no change when the text is identical', () => {
        expect(classifyConfigChange(BASE, BASE).kind).toBe('none');
    });

    it('reports no change when only whitespace or comments moved', () => {
        const reformatted = '# a comment\nengines:\n  harper: true\n\n  spell_language: "en-US"\n';
        expect(classifyConfigChange(BASE, reformatted).kind).toBe('none');
    });

    it('calls a newly silenced rule subtractive and names it', () => {
        const after = `${BASE}rules:\n  languagetool.ARROWS:\n    severity: "off"\n`;
        const change = classifyConfigChange(BASE, after);
        expect(change.kind).toBe('subtractive');
        expect([...change.newlyOff]).toEqual(['languagetool.ARROWS']);
    });

    it('calls a second silenced rule subtractive, keeping the first', () => {
        const before = `${BASE}rules:\n  a.One:\n    severity: "off"\n`;
        const after = `${BASE}rules:\n  a.One:\n    severity: "off"\n  b.Two:\n    severity: "off"\n`;
        const change = classifyConfigChange(before, after);
        expect(change.kind).toBe('subtractive');
        expect([...change.newlyOff]).toEqual(['b.Two']);
    });

    it('needs the full check when a rule is turned back on', () => {
        // The diagnostics were dropped by the core and never reached the
        // editor, so there is nothing to un-filter.
        const before = `${BASE}rules:\n  a.One:\n    severity: "off"\n`;
        expect(classifyConfigChange(before, BASE).kind).toBe('full');
    });

    it('needs the full check when a severity merely changes', () => {
        // The severity is decided in the core, so the editor is holding the
        // old one and no amount of filtering will recolour it.
        const before = `${BASE}rules:\n  a.One:\n    severity: "error"\n`;
        const after = `${BASE}rules:\n  a.One:\n    severity: "warning"\n`;
        expect(classifyConfigChange(before, after).kind).toBe('full');
    });

    it('needs the full check when a new rule is added at a severity other than off', () => {
        const after = `${BASE}rules:\n  a.One:\n    severity: "error"\n`;
        expect(classifyConfigChange(BASE, after).kind).toBe('full');
    });

    it('needs the full check when anything outside rules changes', () => {
        const after = 'engines:\n  harper: true\n  vale:\n    enabled: true\n  spell_language: "en-US"\nrules:\n  a.One:\n    severity: "off"\n';
        expect(classifyConfigChange(BASE, after).kind).toBe('full');
    });

    it('needs the full check when an exclude is added alongside a silenced rule', () => {
        const after = `${BASE}exclude:\n  - "drafts/**"\nrules:\n  a.One:\n    severity: "off"\n`;
        expect(classifyConfigChange(BASE, after).kind).toBe('full');
    });

    it('needs the full check when the new text will not parse', () => {
        expect(classifyConfigChange(BASE, 'engines:\n  harper: true\n   bad: 1\n').kind).toBe('full');
    });

    it('ignores key order, which YAML does not make meaningful', () => {
        const reordered = 'engines:\n  spell_language: "en-US"\n  harper: true\n';
        expect(classifyConfigChange(BASE, reordered).kind).toBe('none');
    });
});

describe('silencedBy', () => {
    const rules = new Set(['languagetool.ARROWS', 'typography.capitalization']);

    it('matches the native rule id the diagnostic carries', () => {
        expect(silencedBy(rules, 'languagetool.ARROWS', 'style.unknown')).toBe(true);
    });

    it('matches the unified category, which the core also accepts', () => {
        expect(silencedBy(rules, 'harper.Capitalization', 'typography.capitalization')).toBe(true);
    });

    it('leaves an unrelated diagnostic alone', () => {
        expect(silencedBy(rules, 'harper.Spelling', 'spelling.typo')).toBe(false);
    });

    it('is false for an empty rule set, whatever the ids', () => {
        expect(silencedBy(new Set(), 'harper.Spelling', 'spelling.typo')).toBe(false);
    });

    it('does not match an empty unified id against an empty-string rule', () => {
        expect(silencedBy(new Set(['']), 'harper.Spelling', '')).toBe(false);
    });
});
