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

/** Gmail's stand-in. Sent with Gmail's Trusted Types requirement, which an HTML-string sink anywhere in the page breaks. */
const gmailPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake gmail</title></head>
<body><script src="/fake-gmail.js"></script></body></html>`;

const notionPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake notion</title></head>
<body><script src="/fake-notion.js"></script></body></html>`;

/**
 * Overleaf's learned words, per project: rendered into the project page as
 * `ol-learnedWords`, as Overleaf does, seeded by `?learned=a,b` on a page's
 * first load and changed by POST /spelling/learn and /spelling/unlearn.
 * @type {Map<string, string[]>}
 */
const learned = new Map();
/** What Overleaf's pages carry for their own JSON requests; /spelling/learn refuses a request without it. */
const CSRF_TOKEN = 'stand-in-csrf-token';

/** @param {string} text */
const attribute = (text) => text.replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('<', '&lt;');

/** @param {string} cm @param {string[]} words */
const page = (cm, words) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>fake editor</title>
<meta name="ol-learnedWords" content='${attribute(JSON.stringify(words))}'>
<meta name="ol-csrfToken" content="${CSRF_TOKEN}"></head>
<body><div id="editor"></div><script src="/fake-host-${cm}.js"></script></body></html>`;

const server = http.createServer((req, res) => void serve(req, res));
server.listen(port, '127.0.0.1');
// Notion's stand-in lives on its own loopback origin.
http.createServer((req, res) => void serve(req, res)).listen(port, '127.0.0.2');
// And Gmail's on a third.
http.createServer((req, res) => void serve(req, res)).listen(port, '127.0.0.3');

/** The editor page, with the project's learned words in it. @param {URL} url @param {http.ServerResponse} res */
function projectPage(url, res) {
    const cm = url.searchParams.get('cm') === '6.38' ? '6-38' : 'current';
    const project = url.pathname.split('/', 3)[2] ?? '';
    const seed = url.searchParams.get('learned');
    if (seed !== null && !learned.has(project)) learned.set(project, seed.split(',').filter((w) => w !== ''));
    res.writeHead(200, { 'content-type': 'text/html' }).end(page(cm, learned.get(project) ?? []));
}

/**
 * Overleaf's learn and unlearn: `{ word }` with the page's CSRF token, as
 * Overleaf's editor sends them; the project is the page's (the referrer),
 * where Overleaf keeps the words per user.
 * @param {http.IncomingMessage} req @param {URL} url @param {http.ServerResponse} res
 */
async function spelling(req, url, res) {
    if (req.headers['x-csrf-token'] !== CSRF_TOKEN) {
        res.writeHead(403).end();
        return;
    }
    /** @type {Buffer[]} */
    const chunks = await Array.fromAsync(req);
    /** @type {{ word: string }} */
    const { word } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const project = new URL(req.headers.referer ?? 'http://x/').pathname.split('/', 3)[2] ?? '';
    const words = learned.get(project) ?? [];
    learned.set(project, url.pathname.endsWith('/learn') ? [...words, word] : words.filter((w) => w !== word));
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function serve(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    // /home is Notion's start page: a page of the app that names no workspace.
    if (url.pathname.startsWith('/p/') || url.pathname === '/home') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(notionPage);
        return;
    }
    if (url.pathname.startsWith('/project/')) {
        projectPage(url, res);
        return;
    }
    if (url.pathname.startsWith('/mail/u/')) {
        // ?tt=0 leaves the policy off, for the page-layer suite's injected scripts.
        const tt = url.searchParams.get('tt') === '0' ? {} : { 'content-security-policy': "require-trusted-types-for 'script'" };
        res.writeHead(200, { 'content-type': 'text/html', ...tt }).end(gmailPage);
        return;
    }
    if (req.method === 'POST' && (url.pathname === '/spelling/learn' || url.pathname === '/spelling/unlearn')) {
        await spelling(req, url, res);
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
