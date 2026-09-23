/**
 * What the core could not set up at Initialize, as the log records it.
 *
 * The core names both servers when another one holds the workspace's index:
 * process id, version and executable path. A notification has room for a
 * sentence, so the log gets everything and the notification points at it.
 */
import type { languagecheck } from '../proto/checker';

export interface ServerIdentity {
    readonly pid: number;
    readonly version: string;
    readonly executable: string;
}

export function identityOf(wire: languagecheck.IServerIdentity | null | undefined): ServerIdentity | undefined {
    if (!wire) return undefined;
    return { pid: Number(wire.pid ?? 0), version: wire.version ?? '', executable: wire.executable ?? '' };
}

/** A server as one line: enough to find the process, or the file it runs from. */
export function describeServer(server: ServerIdentity): string {
    return `pid ${server.pid}, version ${server.version || 'unknown'}, ${server.executable || 'executable unknown'}`;
}

/**
 * The log's account of another server holding the index: both servers, and
 * what stops the other one. Deleting its binary is suggested only when it is
 * a different file, which is the old-copy-in-another-folder case.
 */
export function conflictLogLines(other: ServerIdentity, self: ServerIdentity | undefined): string[] {
    const lines = [
        "Another language-check server is using this workspace's index, so this window's server runs without it.",
        `  holding the index: ${describeServer(other)}`,
    ];
    if (self) lines.push(`  this window:       ${describeServer(self)}`);
    lines.push(`  To stop the other one: kill ${other.pid}`);
    if (other.executable && self && other.executable !== self.executable) {
        lines.push(`  It runs from a different file than this window's. If that is an old copy, deleting ${other.executable} stops it being started again.`);
    }
    return lines;
}
