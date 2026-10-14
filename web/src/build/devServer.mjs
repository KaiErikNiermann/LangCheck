// The dev build's watcher side: a WebSocket server on loopback that tells
// the dev extension which build is current, on connect and after each
// build. It only announces; it takes nothing from its clients, and it
// accepts only extensions (by their Origin), so a web page cannot listen.
import { WebSocketServer } from 'ws';

/**
 * @param {{ host: string, port: number, isExtensionOrigin: (origin: string | undefined) => boolean }} options
 * @returns {Promise<{ port: number, announce: (message: string) => void, close: () => Promise<void> }>}
 */
export async function startDevServer({ host, port, isExtensionOrigin }) {
    /** The last announcement, for each extension that connects later. */
    let current = '';
    const server = new WebSocketServer({
        host,
        port,
        maxPayload: 1024,
        /** @param {{ origin: string }} info */
        verifyClient: (info) => isExtensionOrigin(info.origin),
    });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    server.on('connection', (socket) => {
        if (current !== '') socket.send(current);
        // Pings keep the extension's background awake; nothing sent here is acted on.
        socket.on('message', () => {});
    });
    const address = server.address();
    return {
        /** The port it listens on (the one asked for, or the system's pick for 0). */
        port: typeof address === 'object' && address !== null ? address.port : port,
        announce(message) {
            current = message;
            for (const client of server.clients) client.send(message);
        },
        close: () =>
            new Promise((resolve) => {
                for (const client of server.clients) client.terminate();
                server.close(() => {
                    resolve();
                });
            }),
    };
}
