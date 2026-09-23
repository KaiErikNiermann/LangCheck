import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageToolRecovery } from '../checking/languageToolRecovery';
import { CheckResults } from '../checking/results';
import { languagecheck } from '../proto/checker';
import type { Logger } from '../shared/logger';
import type { InspectorEngineHealth } from '../ui/webviews/protocol';

const log = { info: () => undefined, debug: () => undefined } as unknown as Logger;

function health(status: InspectorEngineHealth['status']): InspectorEngineHealth {
    return { name: 'languagetool', status, consecutiveFailures: status === 'ok' ? 0 : 3, lastError: '', lastSuccessEpochMs: 0 };
}

function probeAnswer(status: languagecheck.ProbeStatus): languagecheck.IProbeConfigResponse {
    return { probes: [{ key: 'engines.languagetool.url', engine: 'languagetool', status }] };
}

describe('LanguageToolRecovery', () => {
    let results: CheckResults;
    let probe: ReturnType<typeof vi.fn<() => Promise<languagecheck.IProbeConfigResponse | null>>>;
    let recheck: ReturnType<typeof vi.fn<() => void>>;
    let recovery: LanguageToolRecovery;

    beforeEach(() => {
        vi.useFakeTimers();
        results = new CheckResults();
        probe = vi.fn<() => Promise<languagecheck.IProbeConfigResponse | null>>();
        recheck = vi.fn<() => void>();
        recovery = new LanguageToolRecovery({ log, results, probe, recheck });
    });

    afterEach(() => {
        recovery.dispose();
        vi.useRealTimers();
    });

    it('does not probe while LanguageTool is healthy', async () => {
        results.engineHealth = [health('ok')];
        recovery.healthUpdated();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(probe).not.toHaveBeenCalled();
    });

    it('probes while LanguageTool is down, and re-checks once it answers', async () => {
        results.engineHealth = [health('down')];
        probe.mockResolvedValue(probeAnswer(languagecheck.ProbeStatus.PROBE_STATUS_DOWN));
        recovery.healthUpdated();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(probe).toHaveBeenCalledTimes(3);
        expect(recheck).not.toHaveBeenCalled();

        probe.mockResolvedValue(probeAnswer(languagecheck.ProbeStatus.PROBE_STATUS_OK));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(recheck).toHaveBeenCalledTimes(1);

        // Stopped after the re-check: nothing more until health says otherwise.
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probe).toHaveBeenCalledTimes(4);
    });

    it('stops probing when a check reports LanguageTool healthy again', async () => {
        results.engineHealth = [health('degraded')];
        probe.mockResolvedValue(probeAnswer(languagecheck.ProbeStatus.PROBE_STATUS_DOWN));
        recovery.healthUpdated();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(probe).toHaveBeenCalledTimes(1);

        results.engineHealth = [health('ok')];
        recovery.healthUpdated();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('asks one probe at a time when a probe outlasts the interval', async () => {
        results.engineHealth = [health('down')];
        probe.mockReturnValue(new Promise(() => undefined));
        recovery.healthUpdated();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probe).toHaveBeenCalledTimes(1);
    });
});
