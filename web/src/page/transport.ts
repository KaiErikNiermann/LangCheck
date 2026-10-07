// The client's CoreTransport over the extension's messaging, so the client's
// own Checker, actions and commands run in the page unchanged.
//
// Availability works like VS Code's CoreService: while the native host is
// unavailable the transport reports itself not running, so the Checker
// stops asking (and records why in the Inspector log) instead of showing an
// error on every keystroke. It probes with backoff, and when the host
// answers again it says so, so the open documents can be rechecked.
import type { CoreHandle, CoreTransport } from '../../../extension/src/core/transport';
import type { languagecheck } from '../../../extension/src/proto/checker';
import type { CoreClient } from '../messaging/pageClient';
import { MAX_CHECK_TEXT_BYTES, withinCheckLimits, type CoreRequest } from '../messaging/protocol';

const PROBE_FIRST_MS = 2000;
const PROBE_MAX_MS = 60_000;

export interface AvailabilityEvents {
    /** The host became unavailable; `reason` is the fixed sentence the page may show. */
    unavailable(reason: string): void;
    /** The host answers again after being unavailable. */
    recovered(): void;
    /** A document is too long to check; said once until a check fits again. */
    tooLong(limitBytes: number): void;
}

class WebTransport implements CoreTransport {
    isRunning = true;
    lastFailure: string | null = null;
    private probeDelay = PROBE_FIRST_MS;
    private probeTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private reportedTooLong = false;

    constructor(
        private readonly core: CoreClient,
        private readonly events: AvailabilityEvents,
    ) {}

    async sendRequest(request: languagecheck.Request.$Properties): Promise<languagecheck.Response> {
        // Refused here, with a reason a user can act on, rather than sent to
        // be refused as malformed by the content script, or failed by the
        // host, on every pause in typing.
        const text = request.checkProse?.text;
        if (typeof text === 'string') {
            if (!withinCheckLimits(text)) {
                if (!this.reportedTooLong) this.events.tooLong(MAX_CHECK_TEXT_BYTES);
                this.reportedTooLong = true;
                return { id: 0 } as unknown as languagecheck.Response;
            }
            this.reportedTooLong = false;
        }
        // The content script parses this against the requests a page may make
        // and rebuilds it from the allowed fields (dropping filePath, settings).
        const response = await this.core.request(request as unknown as CoreRequest);
        if (response.ok) return response.response as unknown as languagecheck.Response;
        if (response.code === 'interrupted') {
            // Cut off on the way, not failed: dropped quietly, as a check a
            // newer one replaced is. The content script has the page check
            // again once it has reconnected.
            return { id: 0 } as unknown as languagecheck.Response;
        }
        if (response.code === 'unavailable') {
            // Reported once, by down(); an empty response makes the Checker
            // drop this check quietly instead of showing a second message.
            this.down(response.error);
            return { id: 0 } as unknown as languagecheck.Response;
        }
        // Any other failure reads as an ErrorResponse, as from the core.
        return { id: 0, error: { message: response.error } } as unknown as languagecheck.Response;
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.probeTimer);
    }

    private down(reason: string): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.lastFailure = reason;
        this.events.unavailable(reason);
        this.scheduleProbe();
    }

    private scheduleProbe(): void {
        if (this.disposed) return;
        this.probeTimer = setTimeout(() => {
            void this.core.request({ getMetadata: {} }).then((response) => {
                if (this.disposed) return;
                if (response.ok) {
                    this.isRunning = true;
                    this.lastFailure = null;
                    this.probeDelay = PROBE_FIRST_MS;
                    this.events.recovered();
                    return;
                }
                this.probeDelay = Math.min(this.probeDelay * 2, PROBE_MAX_MS);
                this.scheduleProbe();
            });
        }, this.probeDelay);
    }
}

/** The client's CoreHandle (plus the initialize its commands call) for the web. */
export class WebCore implements CoreHandle {
    readonly client: WebTransport;

    constructor(core: CoreClient, events: AvailabilityEvents) {
        this.client = new WebTransport(core, events);
    }

    /** VS Code re-initializes after a config edit; the native host initializes its workspace per connection. */
    initialize(): Promise<void> {
        return Promise.resolve();
    }

    dispose(): void {
        this.client.dispose();
    }
}
