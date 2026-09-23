import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * Structured logger for the Language Check extension.
 *
 * In development mode (ExtensionMode.Development), all levels are emitted.
 * In production, only `warn` and `error` are emitted by default.
 * The minimum level can be overridden at construction time.
 */
export class Logger {
    private channel: vscode.OutputChannel;
    private minLevel: number;

    constructor(isDev: boolean) {
        this.channel = vscode.window.createOutputChannel('Language Check');
        this.minLevel = isDev ? LEVEL_ORDER.debug : LEVEL_ORDER.warn;
    }

    debug(msg: string, fields?: Record<string, unknown>): void {
        this.log('debug', msg, fields);
    }

    info(msg: string, fields?: Record<string, unknown>): void {
        this.log('info', msg, fields);
    }

    warn(msg: string, fields?: Record<string, unknown>): void {
        this.log('warn', msg, fields);
    }

    error(msg: string, fields?: Record<string, unknown>): void {
        this.log('error', msg, fields);
    }

    show(): void {
        this.channel.show(true);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
        if (LEVEL_ORDER[level] < this.minLevel) return;
        const ts = new Date().toISOString();
        const tag = level.toUpperCase().padEnd(5);
        const extra = fields
            ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
            : '';
        this.channel.appendLine(`[${ts}] ${tag} ${msg}${extra}`);
    }
}
