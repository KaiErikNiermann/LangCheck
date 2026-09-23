/**
 * Checking one document: asking the core, and putting the answer on screen.
 */
import * as path from 'path';
import * as vscode from 'vscode';

import { COMMANDS, executeCommand } from '../commands/ids';
import type { LanguageClient } from '../core/client';
import type { CoreService } from '../core/coreService';
import { hasDockerCompose } from '../core/languagetool';
import { isSpellingRule, ruleIdOf, type ExtendedDiagnostic } from '../diagnostics/diagnostic';
import type { DiagnosticStore, Suppression } from '../diagnostics/store';
import type { Logger } from '../shared/logger';
import type { InspectorLog } from '../ui/inspectorLog';
import type { StatusBars } from '../ui/statusBars';
import { byteToCharConverter } from './offsets';
import { toDiagnostic, toInspectorRanges, toNameSpans } from './response';
import type { CheckResults } from './results';
import { CheckSlots } from './scheduler';
import { uriKey } from '../shared/documents';

/** What a check did, for the caller that asked for it. */
export interface CheckOutcome {
    /** How many diagnostics the document ended up with. */
    diagnostics: number;
    /**
     * Whether the engines ran, or the core served the result it already had.
     *
     * Reported by the core rather than guessed from elapsed time: "fast" and
     * "cached" are not the same claim, and only one of them is checkable.
     */
    servedFromCache: boolean;
}

/** What the rest of the extension is told while a check lands, at the points it always was. */
export interface CheckObserver {
    /** The check's timings and summary are in CheckResults. */
    checkRecorded(timings: { name: string; durationMs: number }[]): void;
    /** The core reported engine health, now in CheckResults. */
    healthUpdated(): void;
    /** Diagnostics were published for a document. */
    diagnosticsPublished(diagnostics: readonly ExtendedDiagnostic[]): void;
}

export interface CheckerDeps {
    readonly core: CoreService;
    readonly log: Logger;
    readonly store: DiagnosticStore;
    readonly suppression: Suppression;
    readonly results: CheckResults;
    readonly statusBars: StatusBars;
    readonly inspectorLog: InspectorLog;
    readonly observer: CheckObserver;
}

/**
 * Max simultaneous CheckProse RPCs, to avoid flooding the server (each
 * LanguageTool check holds the orchestrator mutex for seconds).
 */
const MAX_CONCURRENT_CHECKS = 3;

export class Checker {
    private readonly slots = new CheckSlots(MAX_CONCURRENT_CHECKS);
    /** Checks currently running, keyed by document URI, with the text they cover. */
    private readonly inFlight = new Map<string, { text: string; result: Promise<number> }>();
    private ltDownNotificationShown = false;

    constructor(private readonly deps: CheckerDeps) {}

    /**
     * Check a document, joining a check already running over the exact same text
     * instead of starting a second one. Returns the number of issues found, or -1
     * on error.
     *
     * Many things ask for a re-check — an edit, a save, a just-applied fix, the
     * SpeedFix or Inspector panel opening — and on a large document a check takes
     * seconds. Without coalescing, those requests pile up behind the concurrency
     * limiter and each one re-derives an answer that is already on its way, so the
     * latency the user sees is the queue depth times the real cost.
     */
    async check(document: vscode.TextDocument): Promise<number> {
        const { core, inspectorLog } = this.deps;
        // A client that has given up restarting can never answer. Bail out before
        // taking a concurrency slot, or a down core starves the slots for a full
        // request timeout each and every queued check backs up behind it.
        if (!core.client?.isRunning) {
            const reason = core.client?.lastFailure;
            if (reason) {
                inspectorLog.push('error', 'checkDocument', `Core unavailable: ${reason}`, {
                    details: path.basename(document.fileName),
                });
            }
            return -1;
        }

        const t0 = performance.now();
        const textContent = document.getText();
        const readMs = performance.now() - t0;

        const uri = uriKey(document.uri);
        const inFlight = this.inFlight.get(uri);
        if (inFlight && inFlight.text === textContent) {
            inspectorLog.push('debug', 'checkDocument', `Joining in-flight check for ${path.basename(document.fileName)}`);
            return inFlight.result;
        }

        const result = this.run(document, core.client, textContent, readMs);
        this.inFlight.set(uri, { text: textContent, result });
        try {
            return await result;
        } finally {
            // Clear only our own entry: if the text changed mid-flight a newer check
            // has already claimed the slot and must stay joinable.
            if (this.inFlight.get(uri)?.result === result) {
                this.inFlight.delete(uri);
            }
        }
    }

    /** The check itself, once {@link check} has decided one is needed. */
    private async run(
        document: vscode.TextDocument,
        client: LanguageClient,
        textContent: string,
        readMs: number,
    ): Promise<number> {
        const { log, store, suppression, results, statusBars, inspectorLog, observer } = this.deps;
        const shortName = path.basename(document.fileName);
        log.debug('checkDocument', { file: document.fileName, lang: document.languageId });
        inspectorLog.push('info', 'checkDocument', `Checking ${shortName} (${document.languageId})`);

        // Wait for a concurrency slot so we don't flood the server
        await this.slots.acquire();
        statusBars.setChecking(true);
        const timings: { name: string; durationMs: number }[] = [];

        try {
            const t0 = performance.now();
            timings.push({ name: 'Read document', durationMs: readMs });

            const t1 = performance.now();
            inspectorLog.push('debug', 'checkDocument', `Sending CheckProse RPC (${textContent.length} chars)`);
            const response = await client.sendRequest({
                checkProse: {
                    text: textContent,
                    languageId: document.languageId,
                    settings: {},
                    filePath: document.uri.fsPath
                }
            });
            const rpcMs = performance.now() - t1;
            timings.push({ name: 'Core RPC (checkProse)', durationMs: rpcMs });
            inspectorLog.push('info', 'checkDocument', `RPC response received`, { durationMs: rpcMs });

            if (response.checkProse) {
                const t2 = performance.now();
                // Core returns UTF-8 byte offsets; positionAt expects char offsets.
                const byteToChar = byteToCharConverter(textContent);
                const extendedDiagnostics: ExtendedDiagnostic[] = response.checkProse.diagnostics!.map(
                    d => toDiagnostic(d, document, byteToChar));
                timings.push({ name: 'Map diagnostics', durationMs: performance.now() - t2 });

                // Filter out diagnostics for suppressed words / deactivated rules
                if (suppression.words.size > 0 || suppression.rules.size > 0) {
                    const filtered = extendedDiagnostics.filter(d => {
                        const ruleId = ruleIdOf(d, '');
                        if (suppression.rules.size > 0 && ruleId && suppression.rules.has(ruleId)) return false;
                        if (suppression.words.size > 0 && isSpellingRule(ruleId)) {
                            const word = document.getText(d.range).toLowerCase();
                            if (suppression.words.has(word)) return false;
                        }
                        return true;
                    });
                    extendedDiagnostics.length = 0;
                    extendedDiagnostics.push(...filtered);
                }

                const t3 = performance.now();
                results.servedFromCache = response.checkProse.servedFromCache === true;
                store.publishCheck(document.uri, extendedDiagnostics);
                store.notify();
                timings.push({ name: 'Update UI', durationMs: performance.now() - t3 });

                statusBars.updateInsights(vscode.window.activeTextEditor);
                observer.diagnosticsPublished(extendedDiagnostics);

                // Cache extraction data from real Rust core response
                const inspectorRanges = toInspectorRanges(
                    response.checkProse.extraction?.proseRanges ?? [], textContent, byteToChar);

                results.extraction.set(uriKey(document.uri), {
                    prose: inspectorRanges,
                    languageId: document.languageId,
                    syntax: response.checkProse.extraction?.syntax ?? '',
                    maxRangeBytes: (response.checkProse.extraction?.maxRangeBytes as number) ?? 0,
                });

                results.names.set(uriKey(document.uri), toNameSpans(
                    response.checkProse.extraction?.names ?? [], textContent, document, byteToChar));

                // Store timings and check info for inspector
                results.timings = timings;
                const totalProseBytes = inspectorRanges.reduce((sum, r) => sum + (r.endByte - r.startByte), 0);
                results.info = {
                    fileName: path.basename(document.uri.fsPath),
                    fileSize: new TextEncoder().encode(textContent).length,
                    languageId: document.languageId,
                    proseRangeCount: inspectorRanges.length,
                    totalProseBytes,
                    diagnosticCount: extendedDiagnostics.length,
                    englishEngine: 'multi', // All enabled engines run concurrently
                };
                observer.checkRecorded(timings);

                // Process engine health from response
                const protoHealth = response.checkProse.engineHealth ?? [];
                if (protoHealth.length > 0) {
                    results.engineHealth = protoHealth.map(h => ({
                        name: h.name as string,
                        status: (h.status as string) as 'ok' | 'degraded' | 'down',
                        consecutiveFailures: (h.consecutiveFailures as number) ?? 0,
                        lastError: (h.lastError as string) ?? '',
                        lastSuccessEpochMs: Number(h.lastSuccessEpochMs ?? 0),
                    }));
                    observer.healthUpdated();

                    // Update status bar with health indicator
                    statusBars.updateHealth();
                    await this.reportLanguageToolDown();
                }

                inspectorLog.push('info', 'checkDocument', `${extendedDiagnostics.length} issues in ${shortName}`, { durationMs: performance.now() - t0 });
                return extendedDiagnostics.length;
            } else if (response.error) {
                inspectorLog.push('error', 'checkDocument', `Server error: ${response.error.message}`);
                vscode.window.showErrorMessage(vscode.l10n.t('Language Check Error: {0}', response.error.message ?? ''));
                return -1;
            }
        } catch (err) {
            const errStr = String(err);
            log.error('checkDocument failed', { error: errStr, file: document.fileName });
            inspectorLog.push('error', 'checkDocument', errStr, { details: document.fileName });
            if (errStr.includes('timed out')) {
                log.warn('Request timed out — the core process may be busy or the LanguageTool server unresponsive');
            } else {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to communicate with language-check core: {0}', errStr));
            }
            return -1;
        } finally {
            this.slots.release();
            statusBars.setChecking(false);
        }

        return 0;
    }

    /**
     * Warn the first time LanguageTool is seen down, and not again until it has
     * been seen up. Awaited inside the check, as it always was: the slot is held
     * until the warning is answered.
     */
    private async reportLanguageToolDown(): Promise<void> {
        const ltHealth = this.deps.results.engineHealth.find(e => e.name === 'languagetool');
        if (ltHealth && ltHealth.status === 'down' && !this.ltDownNotificationShown) {
            this.ltDownNotificationShown = true;
            const hasDocker = hasDockerCompose();
            const actions = hasDocker
                ? ['Restart Docker', 'Open Inspector', 'Dismiss']
                : ['Open Inspector', 'Dismiss'];
            const action = await vscode.window.showWarningMessage(
                vscode.l10n.t('LanguageTool engine is down: {0}', ltHealth.lastError),
                ...actions,
            );
            if (action === 'Restart Docker') {
                executeCommand(COMMANDS.restartLTDocker);
            } else if (action === 'Open Inspector') {
                executeCommand(COMMANDS.openInspector);
            }
        } else if (ltHealth && ltHealth.status === 'ok') {
            this.ltDownNotificationShown = false;
        }
    }
}
