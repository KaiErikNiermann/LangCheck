// Keeps one CodeMirror view joined to the shim's host. Sites swap the view
// (remount), swap its state (file switch: same view, `setState`), or
// reconfigure in ways that can drop an appended extension; none of these
// announce themselves through public API, so the bridge checks a few
// identities on a timer and re-attaches when one changed. Each check is a
// handful of comparisons; discovery runs only on a change.
import type { EditorView } from '@codemirror/view';
import { createCm6Adapter, type Cm6Adapter } from '../editor/cm6Adapter';
import { discoverCm6Kit } from '../editor/cm6kit';
import { host, type TextDocument } from '../shim/vscode';
import type { SitePage } from '../sites/site';

/** How often the bridge looks for a swapped view, a switched file, or a lost extension. */
export const POLL_MS = 500;

export type BridgeStatus =
    | { readonly state: 'waiting'; readonly reason: string }
    | { readonly state: 'attached'; readonly uri: string; readonly languageId: string }
    | { readonly state: 'stopped' };

interface Attachment {
    readonly view: EditorView;
    readonly document: TextDocument;
    readonly cm6: Cm6Adapter;
}

export class Bridge {
    private attachment: Attachment | undefined;
    private status: BridgeStatus = { state: 'waiting', reason: 'not started' };
    private readonly timer: ReturnType<typeof setInterval>;
    private lastReason = '';

    constructor(
        private readonly site: SitePage,
        private readonly project: string,
    ) {
        this.timer = setInterval(() => { this.tick(); }, POLL_MS);
        this.tick();
    }

    getStatus(): BridgeStatus {
        return this.status;
    }

    stop(): void {
        clearInterval(this.timer);
        this.detach();
        this.status = { state: 'stopped' };
    }

    private detach(): void {
        const current = this.attachment;
        this.attachment = undefined;
        if (current === undefined) return;
        host.close(current.document);
        current.cm6.dispose();
    }

    private wait(reason: string): void {
        this.status = { state: 'waiting', reason };
        if (reason !== this.lastReason) console.info(`[language-check] waiting: ${reason}`);
        this.lastReason = reason;
    }

    private tick(): void {
        try {
            this.reconcile();
        } catch (error) {
            // One failed tick must not end the poller; the next one retries.
            console.error('[language-check]', error);
            this.detach();
            this.wait(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private reconcile(): void {
        const view = this.site.findView();
        if (view === undefined) {
            this.detach();
            this.wait('no editor on the page');
            return;
        }
        const { name, languageId } = this.site.currentDocument(view);
        const uri = `${this.site.id}:/${encodeURIComponent(this.project)}/${encodeURIComponent(name)}`;
        const current = this.attachment;
        if (
            current !== undefined &&
            current.view === view &&
            current.document.uri.toString() === uri &&
            current.document.languageId === languageId &&
            current.cm6.isInstalled()
        ) {
            return;
        }
        this.detach();
        const discovery = discoverCm6Kit(view);
        if (!discovery.ok) {
            this.wait(`CodeMirror classes not found: ${discovery.missing.join(', ')}`);
            return;
        }
        const cm6 = createCm6Adapter(view, discovery.kit, uri, languageId);
        view.dispatch({ effects: discovery.kit.StateEffect.appendConfig.of(cm6.extension) });
        // Verified by behaviour, not assumed: if the page's editor did not
        // take the extension, say so instead of acting attached.
        if (!cm6.isInstalled()) {
            cm6.dispose();
            this.wait('the editor did not accept the extension');
            return;
        }
        const document = host.open(cm6.adapter);
        this.attachment = { view, document, cm6 };
        this.status = { state: 'attached', uri, languageId };
        this.lastReason = '';
        console.info(`[language-check] attached to ${uri} (${languageId})`);
    }
}
