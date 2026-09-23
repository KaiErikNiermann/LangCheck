/**
 * Bringing what is on screen in line with a changed configuration.
 */
import * as vscode from 'vscode';

import type { CoreService } from '../core/coreService';
import { silencedBy } from '../config/rules';
import { ruleIdOf } from '../diagnostics/diagnostic';
import type { DiagnosticStore } from '../diagnostics/store';
import type { Logger } from '../shared/logger';
import type { StatusBars } from '../ui/statusBars';
import type { InspectorPanel } from '../ui/webviews/inspector';
import type { Checker } from './checker';
import type { CheckResults } from './results';

export interface ReloadDeps {
    readonly log: Logger;
    readonly core: CoreService;
    readonly store: DiagnosticStore;
    readonly results: CheckResults;
    readonly statusBars: StatusBars;
    readonly inspector: InspectorPanel;
    readonly checker: Checker;
    readonly isCheckable: (document: vscode.TextDocument) => boolean;
}

/**
 * A config change rebuilds the client and clears the caches. It must not
 * clear which packs the user refused: that is their standing answer, not
 * state derived from the config.
 */
export class Reloader {
    constructor(private readonly deps: ReloadDeps) {}

    /** Re-initialize the server, clear stale diagnostics, and recheck open documents. */
    async reinitializeAndRecheck(): Promise<void> {
        this.deps.log.info('Reinitializing and rechecking');
        await this.deps.core.initialize();
        this.deps.store.clear();
        // The inspector reports which language each range was checked in. Under
        // a new config that answer may have changed, and showing the old one is
        // worse than showing none, so it goes until the re-check replaces it.
        this.deps.results.clearDocuments();
        await this.deps.inspector.update();
        const editors = vscode.window.visibleTextEditors.filter(e => this.deps.isCheckable(e.document));
        this.deps.log.debug('Rechecking visible editors', { count: editors.length });
        for (const editor of editors) {
            this.deps.checker.check(editor.document);
        }
    }

    /**
     * Apply a config change that can only remove diagnostics.
     *
     * Silencing a rule is applied by the core after the engines have run, so
     * checking again produces the same findings and drops one more of them.
     * The answer is already on screen; all that is needed is the same filter
     * the core would apply, and the core told about the new config so the
     * next check it runs for any other reason agrees.
     *
     * Re-checking instead is not merely slower. `reinitializeAndRecheck`
     * clears every diagnostic first, so the whole file goes blank and fills
     * back in -- for a rule the user silenced precisely because they did not
     * want to look at it.
     */
    async applySilencedRules(newlyOff: ReadonlySet<string>): Promise<void> {
        this.deps.log.info('Config silenced rules, filtering in place', { rules: [...newlyOff] });
        for (const [uri, diagnostics] of this.deps.store) {
            const remaining = diagnostics.filter(
                d => !silencedBy(newlyOff, ruleIdOf(d, undefined), d.unifiedId),
            );
            if (remaining.length === diagnostics.length) continue;
            this.deps.store.write(uri, vscode.Uri.parse(uri), remaining);
        }
        this.deps.store.notify();
        this.deps.statusBars.updateInsights(vscode.window.activeTextEditor);
        // Last, and without clearing anything: the core needs the new config
        // for whatever it is asked next, but nothing on screen depends on it.
        await this.deps.core.initialize();
    }
}
