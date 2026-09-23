/**
 * Keeping up with configuration: VS Code settings, the `.languagecheck` file,
 * the wordlists it names, and SLS schemas.
 */
import * as path from 'path';
import * as vscode from 'vscode';

import type { Checker } from '../checking/checker';
import type { Reloader } from '../checking/reload';
import type { CoreService } from '../core/coreService';
import { isSpellingRule, ruleIdOf } from '../diagnostics/diagnostic';
import type { DiagnosticStore } from '../diagnostics/store';
import { findOpenDocument, uriKey, type UriKey } from '../shared/documents';
import type { Logger } from '../shared/logger';
import type { StatusBars } from '../ui/statusBars';
import { spellLanguageOf } from './edits';
import { CONFIG_FILE_NAMES, readFirstConfig, readTextOrEmpty } from './file';
import type { ConfigStatusView } from './gutter';
import { parseDictionaryPaths, wordsAdded } from './parsing';
import { classifyConfigChange } from './rules';
import { getSetting, settingId } from './settings';
import type { WorkspaceConfigState } from './state';

export interface WatcherDeps {
    readonly log: Logger;
    readonly core: CoreService;
    readonly store: DiagnosticStore;
    readonly checker: Checker;
    readonly statusBars: StatusBars;
    readonly configState: WorkspaceConfigState;
    readonly inlayHintEmitter: vscode.EventEmitter<void>;
    readonly reloader: Reloader;
    readonly configStatusView: ConfigStatusView | null;
    readonly isCheckable: (document: vscode.TextDocument) => boolean;
}

/**
 * Settings the core is told about at Initialize, and only then.
 *
 * Changing one of these used to do nothing at all until the window was
 * reloaded: `.languagecheck.yaml` had a file watcher, and VS Code's own
 * settings had nothing. Switching the bundled wordlists off in the
 * Settings UI left every one of their words still accepted, with no
 * indication that the setting had not taken.
 */
const CORE_SETTINGS = ([
    'dictionaries.bundled',
    'dictionaries.disabled',
    'dictionaries.paths',
    'names.enabled',
    'workspace.indexOnOpen',
    'workspace.dbPath',
] as const).map(settingId);

/** Settings that decide which binary runs, so the process has to be replaced. */
const CORE_PROCESS_SETTINGS = (['core.binaryPath', 'core.channel'] as const).map(settingId);

/**
 * Where SLS schemas live, watched for the same reason as the wordlists.
 *
 * The core reads this directory once, at Initialize. Editing a schema did
 * nothing until the next reload -- and a schema is a thing under active
 * development, since writing one is an iterative business of running the
 * checker and adjusting the patterns.
 */
const SCHEMA_DIR_PATTERN = '.langcheck/schemas/**/*';

export class ConfigWatchers {
    /**
     * Watchers over the wordlists the config names, rebuilt when it changes.
     *
     * Adding a path to the config reloaded the core, because the config file
     * is watched -- but editing the wordlist it points at did nothing until
     * the next reload. Editing a wordlist is the more ordinary of the two, so
     * the feature appeared to work once and then stop.
     *
     * Watched individually rather than by a broad glob: these are arbitrary
     * paths a user chose, and a pattern wide enough to cover them would fire
     * on files that have nothing to do with this extension.
     */
    private dictionaryWatchers: vscode.FileSystemWatcher[] = [];

    /**
     * What each watched wordlist held last time it was read.
     *
     * Kept so a change can be classified: adding a word can only remove
     * spelling findings, and removing one needs the check because the finding
     * was dropped inside the core and never reached the editor.
     */
    private readonly wordlistContents = new Map<UriKey, string>();

    /** Where the watchers go, so VS Code disposes them; set by {@link start}. */
    private subscriptions: vscode.Disposable[] = [];

    constructor(private readonly deps: WatcherDeps) {}

    /**
     * Watch the settings, the config file and the wordlists it names, after
     * reading the config as it is now.
     *
     * Everything up to the first read is registered synchronously, as it
     * always was: activation must not yield before the watchers exist.
     */
    async start(subscriptions: vscode.Disposable[]): Promise<void> {
        this.subscriptions = subscriptions;

        subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
            if (CORE_PROCESS_SETTINGS.some(key => event.affectsConfiguration(key))) {
                this.deps.log.info('Core binary setting changed, restarting');
                await this.deps.core.boot();
                return;
            }
            if (CORE_SETTINGS.some(key => event.affectsConfiguration(key))) {
                this.deps.log.info('Core setting changed, reinitializing');
                await this.refreshDictionaryWatchers();
                await this.deps.reloader.reinitializeAndRecheck();
            }
            // Everything else -- the check trigger, the inlay hints, the panel --
            // is read where it is used, so a change takes effect on its own.
        }));

        const configWatcher = vscode.workspace.createFileSystemWatcher('**/.languagecheck.{yaml,yml,json}');
        configWatcher.onDidChange(() => this.checkConfigChange());
        configWatcher.onDidCreate(() => this.checkConfigChange());
        configWatcher.onDidDelete(() => this.checkConfigChange());
        subscriptions.push(configWatcher);

        // Eagerly read the initial config values so we can detect changes
        // even if the config was modified before the extension activated.
        {
            const folder = vscode.workspace.workspaceFolders?.[0];
            const found = folder ? await readFirstConfig(folder) : undefined;
            if (found) {
                const raw = found.text;
                this.deps.configState.seen = { state: 'present', text: raw };
                this.deps.statusBars.setLanguage(spellLanguageOf(raw));
                this.deps.configState.apply(raw);
            }
        }

        // After the config has been read, not before: the wordlists to watch are
        // named in it, and registering the watchers first meant a path from
        // `dictionaries.paths` was never watched at all. Editing the wordlist
        // then did nothing until the config file itself happened to change.
        await this.refreshDictionaryWatchers();
    }

    private async checkConfigChange(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        // Not readFirstConfig: this try also covers everything done with the
        // text below, and an exception there moves on to the next name.
        for (const name of CONFIG_FILE_NAMES) {
            const uri = vscode.Uri.joinPath(folder.uri, name);
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

                const currentLang = spellLanguageOf(raw);
                this.deps.statusBars.setLanguage(currentLang);

                // Any edit, not only the spell language: the rest of the file
                // decides the result just as much, and what is on screen has to
                // match the config that produced it.
                //
                // Except when the only thing that changed is a rule being
                // silenced, which the core applies after the engines have run.
                // Then the findings on screen are already the right ones minus
                // a filter, and re-checking would blank the file and fill it
                // back in to reach the answer it is holding.
                const previous = this.deps.configState.seen;
                const change = previous.state === 'present'
                    ? classifyConfigChange(previous.text, raw)
                    : { kind: 'none' as const, newlyOff: new Set<string>() };
                const changed = previous.state === 'absent'
                    || (previous.state === 'present' && raw !== previous.text);
                this.deps.configState.seen = { state: 'present', text: raw };

                this.deps.configState.apply(raw);
                this.deps.inlayHintEmitter.fire();
                if (changed && change.kind === 'subtractive') {
                    await this.deps.reloader.applySilencedRules(change.newlyOff);
                    this.deps.configStatusView?.refresh();
                } else if (changed) {
                    // Before the recheck: the config may have named a
                    // different wordlist, and the new one has to be watched
                    // from now on.
                    await this.refreshDictionaryWatchers();
                    await this.deps.reloader.reinitializeAndRecheck();
                    // A change from outside the editor -- another window, a
                    // branch switch -- moves the text without a keystroke to
                    // fire the usual trigger.
                    this.deps.configStatusView?.refresh();
                }
                return;
            } catch { /* not found, try next */ }
        }

        // No config file, under any of its names. Deleting one is a config
        // change like any other -- the core falls back to its defaults, and
        // the parsed settings this file fed have to go with it, or an inlay
        // hint keeps skipping a LaTeX environment the config no longer names.
        const hadOne = this.deps.configState.seen.state === 'present';
        this.deps.configState.seen = { state: 'absent' };
        this.deps.statusBars.setLanguage('en-US');
        this.deps.configState.reset();
        this.deps.inlayHintEmitter.fire();
        if (hadOne) {
            await this.deps.reloader.reinitializeAndRecheck();
        }
    }

    /**
     * Apply a wordlist edit that only added words.
     *
     * The accepted words' findings are dropped in place, so the file does not
     * blank and fill back in to arrive at what is already on screen minus one
     * word. The re-check still runs, because the core also accepts affixed
     * forms of a dictionary word through the morphology analyser and this
     * only knows the exact ones -- but it runs without clearing first, so
     * nothing flickers while it does.
     */
    private async applyAcceptedWords(added: ReadonlySet<string>): Promise<void> {
        if (added.size > 0) {
            this.deps.log.info('Wordlist gained words, filtering in place', { words: [...added] });
            for (const [uri, diagnostics] of this.deps.store) {
                const document = findOpenDocument(uri);
                if (!document) continue;
                const remaining = diagnostics.filter(d => {
                    const ruleId = ruleIdOf(d, '');
                    if (!isSpellingRule(ruleId)) return true;
                    return !added.has(document.getText(d.range).toLowerCase());
                });
                if (remaining.length === diagnostics.length) continue;
                this.deps.store.write(uri, document.uri, remaining);
            }
            this.deps.store.notify();
        }
        await this.deps.core.initialize();
        // No clear: `checkDocument` replaces a document's diagnostics in one
        // go when it finishes, so there is no window in which the file looks
        // clean.
        for (const editor of vscode.window.visibleTextEditors) {
            if (this.deps.isCheckable(editor.document)) this.deps.checker.check(editor.document);
        }
    }

    private async refreshDictionaryWatchers(): Promise<void> {
        for (const watcher of this.dictionaryWatchers) watcher.dispose();
        this.dictionaryWatchers = [];

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;

        const schemaWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, SCHEMA_DIR_PATTERN),
        );
        const reloadSchemas = () => this.deps.reloader.reinitializeAndRecheck();
        schemaWatcher.onDidChange(reloadSchemas);
        schemaWatcher.onDidCreate(reloadSchemas);
        schemaWatcher.onDidDelete(reloadSchemas);
        this.dictionaryWatchers.push(schemaWatcher);
        this.subscriptions.push(schemaWatcher);

        const paths = new Set<string>([
            // The file `Add to dictionary` writes to. The core updates its own
            // copy when it writes there, but a hand edit is a change like any
            // other.
            '.languagecheck/dictionary.txt',
            ...getSetting('dictionaries.paths'),
        ]);
        if (this.deps.configState.seen.state === 'present') {
            for (const configured of parseDictionaryPaths(this.deps.configState.seen.text)) {
                paths.add(configured);
            }
        }

        for (const relative of paths) {
            // An absolute path is outside the workspace and outside what a
            // workspace-relative pattern can express; the core still reads it,
            // it simply is not watched.
            if (path.isAbsolute(relative)) continue;
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, relative),
            );
            const uri = vscode.Uri.joinPath(folder.uri, relative);
            const key = uriKey(uri);
            this.wordlistContents.set(key, await readTextOrEmpty(uri));
            const reload = async () => {
                const before = this.wordlistContents.get(key) ?? '';
                const after = await readTextOrEmpty(uri);
                this.wordlistContents.set(key, after);
                const added = wordsAdded(before, after);
                if (added === null) {
                    // A word was taken away, or the file was rewritten.
                    await this.deps.reloader.reinitializeAndRecheck();
                    return;
                }
                await this.applyAcceptedWords(added);
            };
            watcher.onDidChange(reload);
            watcher.onDidCreate(reload);
            watcher.onDidDelete(reload);
            this.dictionaryWatchers.push(watcher);
            this.subscriptions.push(watcher);
        }
    }
}
