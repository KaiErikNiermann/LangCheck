/**
 * Noticing LanguageTool come back.
 *
 * Engine health is what the last check found, so a server that came back up
 * -- a container restarted, a machine back on the network -- went on being
 * reported down until something happened to check a document again. Under
 * the default onSave trigger that could be a long time, with the status bar
 * and the Inspector both saying LanguageTool was down while it was up.
 *
 * While LanguageTool is unhealthy this asks the core's config probe, every
 * few seconds, whether it answers; once it does, the open documents are
 * re-checked, which is what clears the health everywhere it is shown.
 */
import type * as vscode from 'vscode';

import { languagecheck } from '../proto/checker';
import type { Logger } from '../shared/logger';
import type { CheckResults } from './results';

export interface RecoveryDeps {
    readonly log: Logger;
    readonly results: CheckResults;
    /** The core's probe of the saved config; null when there is no core to ask. */
    readonly probe: () => Promise<languagecheck.IProbeConfigResponse | null>;
    readonly recheck: () => void;
}

/** How often an unhealthy LanguageTool is asked whether it answers again. */
const POLL_MS = 5_000;

export class LanguageToolRecovery implements vscode.Disposable {
    private timer: ReturnType<typeof setInterval> | undefined;
    private probing = false;

    constructor(private readonly deps: RecoveryDeps) {}

    /** The core reported engine health: watch while LanguageTool is unhealthy. */
    healthUpdated(): void {
        const languageTool = this.deps.results.engineHealth.find(e => e.name === 'languagetool');
        if (languageTool && languageTool.status !== 'ok') {
            this.timer ??= setInterval(() => void this.poll(), POLL_MS);
        } else {
            this.stop();
        }
    }

    private async poll(): Promise<void> {
        // A probe waits on a timeout when nothing answers, which can outlast
        // the interval; one at a time.
        if (this.probing) return;
        this.probing = true;
        try {
            const response = await this.deps.probe();
            const answers = (response?.probes ?? []).some(p =>
                p.key === 'engines.languagetool.url' && p.status === languagecheck.ProbeStatus.PROBE_STATUS_OK);
            if (answers) {
                this.deps.log.info('LanguageTool answers again, re-checking');
                // Stopped first: if the check fails after all, the health it
                // reports starts the watch again.
                this.stop();
                this.deps.recheck();
            }
        } catch (err) {
            this.deps.log.debug('LanguageTool recovery probe failed', { error: String(err) });
        } finally {
            this.probing = false;
        }
    }

    private stop(): void {
        clearInterval(this.timer);
        this.timer = undefined;
    }

    dispose(): void {
        this.stop();
    }
}
