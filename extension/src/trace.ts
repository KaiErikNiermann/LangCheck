import * as vscode from 'vscode';
import { languagecheck } from './proto/checker';

/** Protobuf message trace logger that writes decoded messages to a VS Code Output Channel. */
export class TraceLogger {
    private channel: vscode.OutputChannel;
    private enabled: boolean;
    private messageCount = 0;

    constructor() {
        this.channel = vscode.window.createOutputChannel('Language Check: Protobuf Trace');
        this.enabled = vscode.workspace.getConfiguration('languageCheck')
            .get<boolean>('trace.enable', false);
    }

    /** Toggle tracing on/off. Returns the new state. */
    public toggle(): boolean {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this.channel.show(true); // true = preserveFocus
            this.log('--- Trace enabled ---');
        } else {
            this.log('--- Trace disabled ---');
        }
        return this.enabled;
    }

    /** Whether tracing is currently enabled. */
    public get isEnabled(): boolean {
        return this.enabled;
    }

    /** Log an outgoing request. */
    public logRequest(request: languagecheck.IRequest): void {
        if (!this.enabled) return;
        this.messageCount++;

        const timestamp = new Date().toISOString();
        const id = request.id != null ? Number(request.id) : '?';
        const type = this.getRequestType(request);
        const summary = this.summarizeRequest(request);

        this.channel.appendLine(`[${timestamp}] ▶ REQ #${id} ${type}`);
        if (summary) {
            this.channel.appendLine(`  ${summary}`);
        }
        this.channel.appendLine('');
    }

    /** Log an incoming response. */
    public logResponse(response: languagecheck.IResponse, durationMs: number): void {
        if (!this.enabled) return;
        this.messageCount++;

        const timestamp = new Date().toISOString();
        const id = response.id != null ? Number(response.id) : '?';
        const type = this.getResponseType(response);
        const summary = this.summarizeResponse(response);

        this.channel.appendLine(`[${timestamp}] ◀ RES #${id} ${type} (${durationMs}ms)`);
        if (summary) {
            this.channel.appendLine(`  ${summary}`);
        }
        this.channel.appendLine('');
    }

    /** Log a raw event (error, restart, etc.). */
    public logEvent(event: string): void {
        if (!this.enabled) return;
        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] ⚡ ${event}`);
        this.channel.appendLine('');
    }

    /** Total number of messages logged. */
    public get count(): number {
        return this.messageCount;
    }

    /** Show the output channel. */
    public show(): void {
        this.channel.show(true);
    }

    /** Dispose the output channel. */
    public dispose(): void {
        this.channel.dispose();
    }

    private log(msg: string): void {
        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] ${msg}`);
    }

    private getRequestType(req: languagecheck.IRequest): string {
        if (req.checkProse) return 'checkProse';
        if (req.initialize) return 'initialize';
        if (req.ignore) return 'ignore';
        if (req.getMetadata) return 'getMetadata';
        if (req.addDictionaryWord) return 'addDictionaryWord';
        return 'unknown';
    }

    private getResponseType(res: languagecheck.IResponse): string {
        if (res.error) return 'error';
        if (res.checkProse) return 'checkProse';
        if (res.getMetadata) return 'getMetadata';
        if (res.ok != null) return 'ok';
        return 'unknown';
    }

    private summarizeRequest(req: languagecheck.IRequest): string {
        if (req.checkProse) {
            const text = req.checkProse.text ?? '';
            const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
            return `lang=${req.checkProse.languageId ?? '?'} file=${req.checkProse.filePath ?? '?'} text="${preview}" (${text.length} bytes)`;
        }
        if (req.initialize) {
            return `workspaceRoot=${req.initialize.workspaceRoot ?? '?'}`;
        }
        if (req.ignore) {
            return `message="${req.ignore.message ?? ''}" context="${req.ignore.context ?? ''}"`;
        }
        if (req.addDictionaryWord) {
            return `word="${req.addDictionaryWord.word ?? ''}"`;
        }
        return '';
    }

    private summarizeResponse(res: languagecheck.IResponse): string {
        if (res.error) {
            return `error: ${res.error.message ?? 'unknown'}`;
        }
        if (res.checkProse && res.checkProse.diagnostics) {
            const count = res.checkProse.diagnostics.length;
            if (count === 0) return '0 diagnostics';
            const rules = res.checkProse.diagnostics
                .slice(0, 5)
                .map(d => d.ruleId ?? '?')
                .join(', ');
            const more = count > 5 ? ` (+${count - 5} more)` : '';
            return `${count} diagnostics: [${rules}]${more}`;
        }
        if (res.ok != null) {
            return `ok=${res.ok}`;
        }
        return '';
    }
}
