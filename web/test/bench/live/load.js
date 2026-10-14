// Times, from the page's navigation start, when the site's own spellchecker
// (Overleaf's, Typst's) and LangCheck first drew their marks on the document
// the page opened with. For the browser-viewer MCP's `evaluate` (Firefox
// content-script world), run right after navigating, and again until both
// counts hold still (each call polls for 13 s, under evaluate's 15 s):
//   const src = await (await fetch('http://127.0.0.1:4199/live-load.js')).text();
//   return await new Function(`return (async () => { ${src} })()`)();
// Served from .bench/ by `node test/bench/live/build.mjs` and any loopback
// server with CORS. Read-only: it edits nothing.
//
// Measured this way because Overleaf's checker does not re-run when a
// script replaces the whole text (compare.js), and it checks only what has
// been in view: its count on load is the first screen's, not the document's.
/* global exportFunction */
const W = window.wrappedJSObject;
const SPELLING = /\b(ol-cm-spelling-error|misspelling)\b/u;

function view() {
    const fromStore = W.overleaf?.unstable?.store?.items?.get('editor.view')?.value;
    if (fromStore) return fromStore;
    const el = document.querySelector('.cm-content')?.wrappedJSObject;
    return el?.cmView?.view ?? el?.cmTile?.view;
}

/** How many words the site's checker marks, read through the public decorations facet. */
function theirs() {
    const v = view();
    if (!v) return -1;
    const st = v.state;
    let count = 0;
    for (const set of st.facet(v.constructor.decorations)) {
        if (typeof set === 'function') continue;
        try {
            set.between(0, st.doc.length, exportFunction((from, to, deco) => {
                if (SPELLING.test(String(deco?.spec?.class ?? ''))) count++;
            }, window));
        } catch { /* not a decoration set */ }
    }
    return count;
}

const ours = () => {
    const stats = W.__languageCheck?.stats?.();
    return stats ? Number(stats.findings) : -1;
};

// Kept across calls: each one polls for 13 s, and a page may need more.
window.__load ??= { probeStart: Math.round(W.performance.now()), theirs: { first: null, last: null, n: -1 }, ours: { first: null, last: null, n: -1 }, len: 0 };
const state = window.__load;
const note = (side, n, now) => {
    if (n > 0 && n !== side.n) {
        side.first ??= now;
        side.last = now;
    }
    side.n = n;
};
const end = Date.now() + 13_000;
while (Date.now() < end) {
    const now = Math.round(W.performance.now());
    note(state.theirs, theirs(), now);
    note(state.ours, ours(), now);
    state.len = view()?.state.doc.length ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 200));
}
return JSON.stringify(state);
