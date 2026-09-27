import { describe, expect, it } from 'vitest';

import { resolutionHint } from '../shared/languageHint';

describe('resolutionHint', () => {
    it('appends the region a bare tag was given', () => {
        expect(resolutionHint('en', 'en-US')).toBe('-US');
        expect(resolutionHint('de', 'de-DE')).toBe('-DE');
    });

    it('matches the written tag case-insensitively', () => {
        expect(resolutionHint('EN', 'en-GB')).toBe('-GB');
    });

    it('shows nothing when the tag was checked as written', () => {
        expect(resolutionHint('fr', 'fr')).toBeNull();
        expect(resolutionHint('en-GB', 'en-gb')).toBeNull();
    });

    it('shows nothing when either side is unknown', () => {
        expect(resolutionHint('', 'en-US')).toBeNull();
        expect(resolutionHint('en', '')).toBeNull();
    });

    it('names the whole tag when it is not an extension of the written one', () => {
        expect(resolutionHint('en', 'fr')).toBe(' → fr');
    });
});
