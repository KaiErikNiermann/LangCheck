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
// CORS=1 lets a page on another origin fetch the bundles: how the manual
// check on the live sites injects them.
const cors = process.env.CORS === '1' ? { 'access-control-allow-origin': '*' } : {};

const notionPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake notion</title></head>
<body><script src="/fake-notion.js"></script></body></html>`;

const page = (cm) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake editor</title></head>
<body><div id="editor"></div><script src="/fake-host-${cm}.js"></script></body></html>`;

const server = http.createServer((req, res) => void serve(req, res));
server.listen(port, '127.0.0.1');
// Notion's stand-in lives on its own loopback origin.
http.createServer((req, res) => void serve(req, res)).listen(port, '127.0.0.2');

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function serve(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    // /home is Notion's start page: a page of the app that names no workspace.
    if (url.pathname.startsWith('/p/') || url.pathname === '/home') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(notionPage);
        return;
    }
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
        res.writeHead(200, { ...cors, 'content-type': 'text/javascript' }).end(body);
    } catch {
        res.writeHead(404).end();
    }
}
