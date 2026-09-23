import { describe, expect, it } from 'vitest';

import { createAPI, severityToString } from '../api';
import { languagecheck } from '../proto/checker';
import type { LanguageClient } from '../core/client';

const check = async () => [];

describe('createAPI', () => {
    it('reports whichever client is current, not the one it was created with', () => {
        let client = { isRunning: true } as LanguageClient;
        const api = createAPI(() => client, check, '1.0.0');
        expect(api.isRunning).toBe(true);
        client = { isRunning: false } as LanguageClient;
        expect(api.isRunning).toBe(false);
    });

    it('reports not running, rather than throwing, when there is no client', () => {
        const api = createAPI(() => null, check, '1.0.0');
        expect(api.isRunning).toBe(false);
    });
});

describe('severityToString', () => {
    it.each([
        [languagecheck.Severity.SEVERITY_ERROR, 'error'],
        [languagecheck.Severity.SEVERITY_WARNING, 'warning'],
        [languagecheck.Severity.SEVERITY_INFORMATION, 'information'],
        [languagecheck.Severity.SEVERITY_HINT, 'hint'],
    ] as const)('maps the core\'s %s to %s', (severity, expected) => {
        expect(severityToString(severity)).toBe(expected);
    });

    it('treats an unset severity as a warning', () => {
        expect(severityToString(undefined)).toBe('warning');
        expect(severityToString(languagecheck.Severity.SEVERITY_UNSPECIFIED)).toBe('warning');
    });
});
