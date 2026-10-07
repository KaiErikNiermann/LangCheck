// Serves the fake site pages for the end-to-end tests: /project/<id> is the
// editor page (the extension's test build matches it on 127.0.0.1 as
// Overleaf and on localhost as Typst), /<bundle>.js the fake host builds.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../.e2e/pages/', import.meta.url));
const extension = fileURLToPath(new URL('../../dist-test/', import.meta.url));
const port = Number(process.env.PORT ?? 4180);

const page = (cm) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake editor</title></head>
<body><div id="editor"></div><script src="/fake-host-${cm}.js"></script></body></html>`;

http.createServer((req, res) => void serve(req, res)).listen(port, '127.0.0.1');

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function serve(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname.startsWith('/project/')) {
        const cm = url.searchParams.get('cm') === '6.38' ? '6-38' : 'current';
        res.writeHead(200, { 'content-type': 'text/html' }).end(page(cm));
        return;
    }
    // /extension/<bundle> is the extension's own build, for the page-layer suite.
    const base = url.pathname.startsWith('/extension/') ? extension : root;
    const file = path.normalize(path.join(base, url.pathname.replace(/^\/extension\//u, '/')));
    if (!file.startsWith(base)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(body);
    } catch {
        res.writeHead(404).end();
    }
}
