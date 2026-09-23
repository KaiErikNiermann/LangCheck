import { describe, expect, it } from 'vitest';

import { createAPI } from '../api';
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
