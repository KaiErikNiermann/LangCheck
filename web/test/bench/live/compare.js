// Times a site's own spellchecker (Typst's, Overleaf's) against LangCheck on
// the same edit, live, in the user's browser. For the browser-viewer MCP's
// `evaluate`, which runs in Firefox's content-script world: build it with
// `node test/bench/live/build.mjs`, paste .bench/live-compare.js as `code`
// once per tab, then start a run and poll for its result (evaluate gives up
// after 15 s, and a run of a long document takes minutes):
//   return window.__lcCompare({ kind: 'latex', bytes: 256000 });   // 'started'
//   return window.__lcResult();                                    // JSON, or {"running":true}
// It REPLACES the open document's text: run it only in a scratch project.
// Instead of pasting: serve .bench/ on loopback with CORS and
//   const src = await (await fetch('http://127.0.0.1:4199/live-compare.js')).text();
//   return await new Function(`return (async () => { ${src} })()`)();
//
// Each run puts generated text the core has never seen into the editor
// (a cold check for both), then types one sentence with a mistake at its
// end (the check an edit makes). For each checker: the first answer after
// the change, and when its findings stopped changing (`settleMs` quiet).
// Theirs are read from the editor state through the public decorations
// facet, as the extension's own reader does (web/src/foreign/); ours from
// the page script's stats. LangCheck's foreign-checker mode matters: in
// `merge` our check waits for theirs.
/* global LcCorpus, exportFunction, cloneInto */
const W = window.wrappedJSObject ?? window;
const unwrap = (o) => o?.wrappedJSObject ?? o;
const cb = (f) => (typeof exportFunction === 'function' ? exportFunction(f, window) : f);
const clone = (o) => (typeof cloneInto === 'function' ? cloneInto(o, window) : o);
const SPELLING = /\b(misspelling|ol-cm-spelling-error)\b/u;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Where a run is, for when it takes longer than expected. */
let progress = {};

function findView() {
    const fromStore = W.overleaf?.unstable?.store?.items?.get('editor.view')?.value;
    if (fromStore) return fromStore;
    const el = unwrap(document.querySelector('.cm-content'));
    return el?.cmView?.view ?? el?.cmTile?.view ?? el?.cmView?.rootView?.view;
}

/** How many words the site's checker marks now, and a signature of where. */
function theirs(view) {
    const st = view.state;
    let count = 0;
    let sig = 0;
    for (const set of st.facet(view.constructor.decorations)) {
        if (typeof set === 'function') continue;
        try {
            set.between(0, st.doc.length, cb((from, to, deco) => {
                if (!SPELLING.test(String(deco?.spec?.class ?? ''))) return;
                count++;
                sig = (sig * 31 + from * 7 + to) % 1_000_000_007;
            }));
        } catch { /* not a decoration set */ }
    }
    return { count, sig };
}

const ours = () => {
    const stats = W.__languageCheck?.stats?.();
    return stats ? { checks: Number(stats.checks), findings: Number(stats.findings) } : { checks: -1, findings: -1 };
};

/** Applies `change` and watches both checkers until each has been quiet for `settleMs`. */
async function watch(view, change, { settleMs, maxMs }) {
    const t0 = performance.now();
    const before = { theirs: theirs(view), ours: ours() };
    view.dispatch(clone(change));
    const state = {
        theirs: { last: before.theirs, first: null, settled: null },
        ours: { last: before.ours, first: null, settled: null },
    };
    while (performance.now() - t0 < maxMs) {
        await sleep(50);
        const now = performance.now() - t0;
        progress = { now: Math.round(now), theirs: state.theirs, ours: state.ours };
        const t = theirs(view);
        // Their marks are mapped through the change at once; their answer is a
        // change in the set that the document did not make.
        if (t.sig !== state.theirs.last.sig || t.count !== state.theirs.last.count) {
            if (now > 60) state.theirs.first ??= Math.round(now);
            state.theirs.last = t;
            state.theirs.settled = Math.round(now);
        }
        const o = ours();
        if (o.checks !== state.ours.last.checks || o.findings !== state.ours.last.findings) {
            if (o.checks > before.ours.checks) state.ours.first ??= Math.round(now);
            state.ours.last = o;
            state.ours.settled = Math.round(now);
        }
        const quiet = (side) => side.settled !== null && now - side.settled >= settleMs;
        if (quiet(state.theirs) && quiet(state.ours) && state.ours.last.checks > before.ours.checks) break;
    }
    return {
        theirs: { firstMs: state.theirs.first, settledMs: state.theirs.settled, marks: state.theirs.last.count },
        ours: { firstMs: state.ours.first, settledMs: state.ours.settled, findings: state.ours.last.findings },
        timedOut: performance.now() - t0 >= maxMs,
    };
}

async function compare({ kind, bytes, seed = Date.now() % 1_000_000, settleMs = 3000, maxMs = 180_000 }) {
    const view = findView();
    if (!view) return { error: 'no CodeMirror view' };
    const text = (kind === 'typst' ? LcCorpus.typst : LcCorpus.latex)(seed, bytes);
    const open = await watch(view, { changes: { from: 0, to: view.state.doc.length, insert: text } }, { settleMs, maxMs });
    const end = view.state.doc.length;
    const edit = await watch(view, { changes: { from: end, insert: '\n\nOne more sentence to recieve here.' } }, { settleMs, maxMs });
    return { kind, bytes: text.length, open, edit };
}

let last = { idle: true };
window.__lcProgress = () => JSON.stringify(progress);
window.__lcCompare = (options) => {
    if (last.running) return 'a run is still going';
    last = { running: true };
    compare(options).then((result) => { last = result; }, (error) => { last = { error: String(error) }; });
    return 'started';
};
window.__lcResult = () => JSON.stringify(last);
return `installed; LangCheck page script ${W.__languageCheck ? 'present' : 'absent'}`;
