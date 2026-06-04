import { describe, it, expect } from 'vitest';
import {
    formatSuggestionLabel,
    visualizeWhitespace,
    describeWhitespaceFix,
    speedFixSuggestionLabel,
    displayOriginalText,
} from '../inlayLabels';

describe('visualizeWhitespace', () => {
    it('renders spaces, tabs and newlines as visible glyphs', () => {
        expect(visualizeWhitespace('  ')).toBe('␣␣');
        expect(visualizeWhitespace('\t')).toBe('⇥');
        expect(visualizeWhitespace('\n')).toBe('⏎');
        expect(visualizeWhitespace('\r\n')).toBe('⏎');
    });
});

describe('describeWhitespaceFix', () => {
    it('describes collapsing redundant spaces (bare phrase, no prefix)', () => {
        expect(describeWhitespaceFix('  ', ' ')).toBe('remove extra space');
        expect(describeWhitespaceFix('   ', ' ')).toBe('remove 2 extra spaces');
        expect(describeWhitespaceFix('     ', ' ')).toBe('remove 4 extra spaces');
    });

    it('falls back to visible glyphs for non-space whitespace', () => {
        expect(describeWhitespaceFix('\t', ' ')).toBe('"␣"');
    });
});

describe('formatSuggestionLabel', () => {
    it('returns null when there is no suggestion', () => {
        expect(formatSuggestionLabel('foo', undefined)).toBeNull();
    });

    it('renders a plain spelling correction', () => {
        expect(formatSuggestionLabel('teh', 'the')).toEqual({ label: ' → the', applyValue: 'the' });
    });

    it('renders a deletion', () => {
        expect(formatSuggestionLabel('foo', '')).toEqual({ label: ' → (remove)', applyValue: '' });
    });

    it('describes a redundant-space correction instead of showing invisible chars', () => {
        // The reported bug: "  " → " " used to render as " →  ".
        expect(formatSuggestionLabel('  ', ' ')).toEqual({
            label: ' → remove extra space',
            applyValue: ' ',
        });
    });

    it('handles a longer run of spaces', () => {
        expect(formatSuggestionLabel('    ', ' ')).toEqual({
            label: ' → remove 3 extra spaces',
            applyValue: ' ',
        });
    });

    it('renders Harper insert suggestions, visualizing whitespace inserts', () => {
        expect(formatSuggestionLabel('x', 'Insert "comma"')).toEqual({
            label: ' → insert comma',
            applyValue: 'Insert "comma"',
        });
        expect(formatSuggestionLabel('x', 'Insert " "')).toEqual({
            label: ' → insert ␣',
            applyValue: 'Insert " "',
        });
    });

    it('renders punctuation insertion and removal', () => {
        expect(formatSuggestionLabel('word', 'word.')).toEqual({
            label: ' → insert "."',
            applyValue: 'word.',
        });
        expect(formatSuggestionLabel('word.', 'word')).toEqual({
            label: ' → remove "."',
            applyValue: 'word',
        });
    });
});

describe('speedFixSuggestionLabel (panel action buttons)', () => {
    it('describes whitespace fixes (capitalized, no arrow)', () => {
        expect(speedFixSuggestionLabel('  ', ' ')).toBe('Remove extra space');
        expect(speedFixSuggestionLabel('    ', ' ')).toBe('Remove 3 extra spaces');
    });

    it('keeps existing wording for empty and insert suggestions', () => {
        expect(speedFixSuggestionLabel('foo', '')).toBe('Remove text');
        expect(speedFixSuggestionLabel('x', 'Insert "comma"')).toBe('Insert "comma"');
        expect(speedFixSuggestionLabel('x', 'Insert " "')).toBe('Insert "␣"');
    });

    it('passes normal word replacements through unchanged', () => {
        expect(speedFixSuggestionLabel('teh', 'the')).toBe('the');
    });
});

describe('displayOriginalText', () => {
    it('visualizes whitespace-only spans, leaves real text alone', () => {
        expect(displayOriginalText('  ')).toBe('␣␣');
        expect(displayOriginalText('\t')).toBe('⇥');
        expect(displayOriginalText('teh')).toBe('teh');
        expect(displayOriginalText('')).toBe('');
    });
});
