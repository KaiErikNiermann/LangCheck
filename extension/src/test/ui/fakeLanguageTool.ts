/**
 * A LanguageTool that answers and finds nothing, for the tests about what
 * the panel does when one comes up. A real server takes most of a minute to
 * start, and the UI tests should not need Docker.
 *
 * It serves the two endpoints the core uses: `GET /v2/languages`, which the
 * config probe asks, and `POST /v2/check`.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeLanguageTool {
    readonly url: string;
    close(): Promise<void>;
}

/** Listen on `port`, or on any free one when it is 0. */
export async function startFakeLanguageTool(port = 0): Promise<FakeLanguageTool> {
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET' && request.url?.startsWith('/v2/languages')) {
            response.end(JSON.stringify([{ name: 'English (US)', code: 'en', longCode: 'en-US' }]));
        } else if (request.method === 'POST' && request.url?.startsWith('/v2/check')) {
            request.resume();
            request.on('end', () => response.end(JSON.stringify({ matches: [] })));
        } else {
            response.statusCode = 404;
            response.end('{}');
        }
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const { port: bound } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${bound}`,
        close: () => new Promise(resolve => {
            server.closeAllConnections();
            server.close(() => resolve());
        }),
    };
}

/** A port nothing listens on, for a server that is to come up there later. */
export async function freePort(): Promise<number> {
    const probe = await startFakeLanguageTool();
    await probe.close();
    return Number(new URL(probe.url).port);
}
