// The extension's config page: the workspace's config in Monaco, with the
// client's own ConfigStatusView drawing what each key reaches in the gutter
// and squiggling what is wrong, as VS Code shows the file. It runs in an
// extension tab the background opened for one workspace, and reads, probes
// and writes the config only through the config port (messaging/config.ts).
// Saving reloads the checks in every page on the workspace (the background
// re-initializes the core, then tells the pages).
import browser, { type Runtime } from 'webextension-polyfill';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import { ConfigStatusView } from '../../../extension/src/config/gutter';
import type { languagecheck } from '../../../extension/src/proto/checker';
import { createMonacoAdapter } from '../editor/monacoAdapter';
import { CONFIG_PORT_NAME, MAX_CONFIG_TEXT_BYTES, type ConfigRequest } from '../messaging/config';
import type { PageResponse } from '../messaging/protocol';
import { host, Uri, workspace } from '../shim/vscode';

/** Typing pause before the config is saved: long enough not to save half a key. */
const SAVE_DELAY_MS = 1000;

type Say = (text: string, state: 'saved' | 'unsaved' | 'saving' | 'error') => void;

/**
 * The config port, as requests that each get their answer. The background
 * can restart under the page (an MV3 service worker is stopped when idle):
 * the port then closes, and the next request opens a new one, which the
 * restarted background serves (it keeps its config tabs across a restart).
 * A request that cannot be sent at all is answered "unavailable", never
 * left pending.
 */
function connect(): (request: ConfigRequest) => Promise<PageResponse> {
    const ids = { next: 1 };
    const pending = new Map<number, (response: PageResponse) => void>();
    const link: { port: Runtime.Port | undefined } = { port: undefined };
    const open = (): Runtime.Port => {
        const port = browser.runtime.connect({ name: CONFIG_PORT_NAME });
        port.onMessage.addListener((message: unknown) => {
            const { id, response } = (message ?? {}) as { id?: unknown; response?: PageResponse };
            if (typeof id !== 'number' || response === undefined) return;
            pending.get(id)?.(response);
            pending.delete(id);
        });
        port.onDisconnect.addListener(() => {
            if (link.port === port) link.port = undefined;
            for (const [id, resolve] of pending) resolve({ id, ok: false, code: 'unavailable', error: 'the extension restarted; try again' });
            pending.clear();
        });
        return port;
    };
    return (request) =>
        new Promise((resolve) => {
            const id = ids.next++;
            try {
                link.port ??= open();
                pending.set(id, resolve);
                link.port.postMessage({ id, request });
            } catch (error) {
                pending.delete(id);
                link.port = undefined;
                resolve({ id, ok: false, code: 'unavailable', error: error instanceof Error ? error.message : String(error) });
            }
        });
}

async function start(): Promise<void> {
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- Monaco reads its worker's URL from this global
    (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
        getWorkerUrl: () => browser.runtime.getURL('config/editor.worker.js'),
    };
    const status = document.querySelector<HTMLElement>('#status');
    const say: Say = (text, state) => {
        if (status === null) return;
        status.textContent = text;
        status.dataset.state = state;
    };
    const ask = connect();
    const read = await ask({ readConfig: {} });
    if (!read.ok) {
        say(`The config could not be read: ${read.error}`, 'error');
        return;
    }
    const config = read.response.readConfig as languagecheck.ReadConfigResponse.$Properties;
    const fileName = config.fileName ?? '.languagecheck.yaml';
    document.title = `${fileName} - LangCheck`;
    const container = document.querySelector<HTMLElement>('#editor');
    if (container === null) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const editor = monaco.editor.create(container, {
        value: config.text ?? '',
        language: 'yaml',
        glyphMargin: true,
        automaticLayout: true,
        minimap: { enabled: false },
        theme: dark ? 'vs-dark' : 'vs',
    });

    // The shim's workspace: one folder, holding this one file, so the view
    // takes it for the config in force.
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: Uri.parse('config:'), name: 'workspace', index: 0 }];
    const adapter = createMonacoAdapter(monaco, editor, `config:/${fileName}`, 'yaml', (message) => {
        say(message, 'error');
    });
    const document_ = host.open(adapter);
    const view = new ConfigStatusView(
        Uri.parse(browser.runtime.getURL('config')),
        async (text, _filePath, format) => {
            const answer = await ask({ probeConfig: { text, format: format === 'json' ? 'json' : 'yaml' } });
            return answer.ok ? (answer.response.probeConfig as languagecheck.ProbeConfigResponse.$Properties) : null;
        },
        { warn: (message: string) => { console.warn('[language-check]', message); } },
    );
    view.activate();

    let saved = config.text ?? '';
    let saving: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    say(config.exists === true ? 'Saved' : 'No config yet: what you type here will be saved as one', 'saved');

    /** Saves what the editor holds, one save at a time; a newer text saves after the one in flight. */
    const save = async (): Promise<void> => {
        clearTimeout(timer);
        await saving;
        const text = editor.getValue();
        if (text === saved) return;
        if (new TextEncoder().encode(text).length > MAX_CONFIG_TEXT_BYTES) {
            say(`Not saved: the config is larger than ${String(MAX_CONFIG_TEXT_BYTES / 1024)} KiB.`, 'error');
            return;
        }
        say('Saving…', 'saving');
        saving = ask({ writeConfig: { text } }).then((answer) => {
            if (answer.ok) {
                saved = text;
                say(editor.getValue() === saved ? 'Saved' : 'Unsaved changes', editor.getValue() === saved ? 'saved' : 'unsaved');
                host.onDidSave.fire(document_);
            } else {
                say(`Not saved: ${answer.error}`, 'error');
            }
        });
        await saving;
    };

    editor.onDidChangeModelContent(() => {
        say('Unsaved changes', 'unsaved');
        clearTimeout(timer);
        timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());
    editor.focus();
    if (__LANGUAGE_CHECK_TEST__) {
        // The e2e tests set text through the editor's model (typed YAML would get Monaco's auto-indent).
        // eslint-disable-next-line unicorn/no-global-object-property-assignment -- test builds only
        (globalThis as { __configEditor?: unknown }).__configEditor = editor;
    }
}

declare const __LANGUAGE_CHECK_TEST__: boolean;

void start();
