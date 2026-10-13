// The palette's own page, shown in an iframe the content script puts over
// the site. It runs in the extension's origin, with its own custom-element
// registry: a site that already defines <ninja-keys> cannot collide with it,
// and the site's scripts and styles cannot reach in.
//
// The content script hands over a MessagePort and the commands to list; the
// page answers with { type: 'run', id } or { type: 'close' }. Which command
// to run is checked again on the other side; this page holds no authority.
import 'ninja-keys';
import { PALETTE_INIT_TYPE, type ContentToPalette, type PaletteToContent } from './protocol';
import { holdKeys, MAX_TYPED_CHARS, parseBinding } from './typing';
import { PALETTE, isPaletteCommand } from './commands';

// This page holds the keyboard from the moment its script runs, which is
// while the page is still loading, before the content script can focus the
// frame (it does so on `load`). Until then the content script holds the
// site's keys; from then on, this. Holding only once the init message had
// arrived left a gap: a key typed after the frame took focus and before the
// message was handled reached a page with no listener and no search box, and
// was lost ("opn sp" for "open sp", so Enter matched nothing). The binding
// that closes the palette comes in the URL fragment, known at load.
const hotkey = parseBinding(decodeURIComponent(location.hash.slice(1))) ?? '';
/** The content script's port, once sent; a close asked for before then is sent when it arrives. */
const link: { port: MessagePort | undefined; closeAsked: boolean } = { port: undefined, closeAsked: false };
const send = (message: PaletteToContent): void => {
    if (link.port === undefined) {
        if (message.type === 'close') link.closeAsked = true;
        return;
    }
    link.port.postMessage(message);
};
const hold = holdKeys(window, hotkey, () => {
    send({ type: 'close' });
});

// The parent is whichever site the content script runs on, so its origin is
// not known here; the source is checked instead. A page that embeds this one
// and sends its own init gets a palette that can only message that page.
// eslint-disable-next-line sonarjs/post-message
window.addEventListener('message', (event: MessageEvent) => {
    if (link.port !== undefined || event.source !== window.parent) return;
    const data = event.data as { type?: unknown; ids?: unknown } | null;
    const port = event.ports[0];
    if (port === undefined || data?.type !== PALETTE_INIT_TYPE) return;
    link.port = port;
    if (link.closeAsked) {
        send({ type: 'close' });
        return;
    }
    const ids = Array.isArray(data.ids) ? data.ids.filter((id) => isPaletteCommand(id)) : [];
    show(port, PALETTE.filter((entry) => ids.includes(entry.id)));
});

function show(port: MessagePort, entries: typeof PALETTE): void {
    const ninja = document.createElement('ninja-keys');
    // The same binding that opened it closes it, and inside the iframe it
    // cannot fall through to the browser's own use of it (print, for Ctrl+P).
    ninja.openHotkey = hotkey;
    ninja.placeholder = 'Run a Language Check command';
    ninja.data = entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        section: 'Language Check',
        handler: () => {
            send({ type: 'run', id: entry.id });
        },
    }));
    ninja.addEventListener('close', () => {
        send({ type: 'close' });
    });
    // Keys typed here since the page loaded (`hold`) come after what the
    // site's page kept: together they are the search the user typed.
    port.addEventListener('message', (event: MessageEvent) => {
        const message = event.data as Partial<ContentToPalette> | null;
        if (message?.type !== 'typed' || typeof message.text !== 'string') return;
        // Keys typed here came after the page's, unless the page's ended in Enter.
        const submit = message.submit === true || hold.submitted();
        const search = (message.submit === true ? message.text : message.text + hold.typed()).slice(0, MAX_TYPED_CHARS);
        hold.release();
        if (search !== '') ninja.open({ search });
        if (submit) void ninja.updateComplete.then(() => { ninja.submit(); });
    });
    port.start();
    document.addEventListener(
        'focusin',
        () => {
            send({ type: 'ready' });
        },
        { once: true },
    );
    document.body.replaceChildren(ninja);
    ninja.open();
}
