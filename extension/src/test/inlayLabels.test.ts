import { describe, it, expect } from 'vitest';
import { formatSuggestionLabel, visualizeWhitespace, describeWhitespaceFix } from '../inlayLabels';

describe('visualizeWhitespace', () => {
    it('renders spaces, tabs and newlines as visible glyphs', () => {
        expect(visualizeWhitespace('  ')).toBe('␣␣');
        expect(visualizeWhitespace('\t')).toBe('⇥');
        expect(visualizeWhitespace('\n')).toBe('⏎');
        expect(visualizeWhitespace('\r\n')).toBe('⏎');
    });
});

describe('describeWhitespaceFix', () => {
    it('describes collapsing redundant spaces', () => {
        expect(describeWhitespaceFix('  ', ' ')).toBe(' → remove extra space');
        expect(describeWhitespaceFix('   ', ' ')).toBe(' → remove 2 extra spaces');
        expect(describeWhitespaceFix('     ', ' ')).toBe(' → remove 4 extra spaces');
    });

    it('falls back to visible glyphs for non-space whitespace', () => {
        expect(describeWhitespaceFix('\t', ' ')).toBe(' → "␣"');
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
