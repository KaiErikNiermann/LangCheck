/**
 * What the checking pipeline needs of the core, and nothing more.
 *
 * The Checker and the diagnostic actions only ever ask whether the core is
 * up, why it is not, and send it a request. Typing them against this rather
 * than the stdio LanguageClient is what lets the same pipeline run in the web
 * extension, whose core sits behind a native messaging port.
 */
import type { languagecheck } from '../proto/checker';

export interface CoreTransport {
    readonly isRunning: boolean;
    readonly lastFailure: string | null;
    sendRequest(request: languagecheck.Request.$Properties): Promise<languagecheck.Response>;
}

/** Where the transport is found: it is replaced when the core restarts. */
export interface CoreHandle {
    readonly client: CoreTransport | null;
}
