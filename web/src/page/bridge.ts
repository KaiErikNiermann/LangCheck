// Keeps the site's editor joined to the shim's host. Sites swap the editor
// (remount), swap what it shows (file switch, page navigation), or
// reconfigure in ways that drop what we installed; none of these announce
// themselves through public API, so the bridge compares a few identities
// on a timer and re-attaches when one changed. Each check is a handful of
// comparisons; joining an editor runs only on a change.
import type { AttachedEditor, EditorHandle } from '../editor/handle';
import { host, Uri, type TextDocument } from '../shim/vscode';
import type { SitePage } from '../sites/site';

/** How often the bridge looks for a swapped editor, a switched document, or a lost install. */
export const POLL_MS = 500;

export type BridgeStatus =
    | { readonly state: 'waiting'; readonly reason: string }
    | { readonly state: 'attached'; readonly uri: string; readonly languageId: string }
    | { readonly state: 'stopped' };

interface Attachment {
    readonly handle: EditorHandle;
    readonly identity: object;
    readonly document: TextDocument;
    readonly editor: AttachedEditor;
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

    /**
     * Where the document at `fsPath` is in the site's project now
     * (EditorHandle.path), when it is the one attached and the site names
     * one; without an argument, the attached document's.
     */
    documentPath(fsPath?: string): string | undefined {
        const current = this.attachment;
        if (current === undefined || (fsPath !== undefined && current.document.uri.fsPath !== fsPath)) return undefined;
        return current.handle.path?.();
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
        current.editor.dispose();
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
        const handle: EditorHandle | undefined = this.site.findEditor();
        if (handle === undefined) {
            this.detach();
            this.wait('no editor on the page');
            return;
        }
        // In Uri's own string form, so it compares equal to the document's.
        const uri = Uri.joinPath(Uri.parse(`${this.site.id}:/`), this.project, handle.name).toString();
        const current = this.attachment;
        if (
            current?.identity === handle.identity &&
            current.document.uri.toString() === uri &&
            current.document.languageId === handle.languageId &&
            current.editor.isInstalled()
        ) {
            return;
        }
        this.detach();
        const result = handle.attach(uri);
        if (!result.ok) {
            this.wait(result.reason);
            return;
        }
        const document = host.open(result.editor.adapter);
        this.attachment = { handle, identity: handle.identity, document, editor: result.editor };
        this.status = { state: 'attached', uri, languageId: handle.languageId };
        this.lastReason = '';
        console.info(`[language-check] attached to ${uri} (${handle.languageId})`);
    }
}
