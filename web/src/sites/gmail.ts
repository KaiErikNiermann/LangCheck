// Gmail: each compose (a new message, a reply, a pop-out) is one
// contenteditable body, `[role="textbox"][g_editable="true"]` labelled
// "Message Body", holding a <div> per line (research/gmail-editor.md). The
// small and the full-screen compose are the same element at another size,
// so an editor attached in one mode stays attached in the other. A page can
// hold several composes; the one being written in is checked.
import { domEditor } from '../editor/handle';
import type { SitePage, SiteWorkspace } from './site';

/** `/mail/u/<n>/…`: the signed-in account, which is the workspace (one dictionary per account). */
const ACCOUNT = /^\/mail\/u\/(\d{1,2})(?:\/|$)/u;

export function gmailAccountFromPath(pathname: string): string | undefined {
    const n = ACCOUNT.exec(pathname)?.[1];
    return n === undefined ? undefined : `u${n}`;
}

export const gmailWorkspace: SiteWorkspace = { id: 'gmail', projectFromPath: gmailAccountFromPath };

const BODY = '[role="textbox"][contenteditable="true"][g_editable="true"]';

/** Elements that are not the writer's own prose: someone else's message quoted, a signature, a smart chip. */
const isAtom = (element: Element): boolean =>
    element.getAttribute('contenteditable') === 'false' || element.classList.contains('gmail_quote') || element.classList.contains('gmail_signature');

/** A compose body's name for as long as the page lives: its generated id, else a counter's. */
function namer(): (body: Element) => string {
    const names = new WeakMap<Element, string>();
    let unnamed = 0;
    return (body) => {
        let name = names.get(body);
        if (name === undefined) {
            unnamed += 1;
            name = body.id === '' ? `compose-${String(unnamed)}` : `compose-${body.id.replaceAll(/[^A-Za-z0-9_-]/gu, '')}`;
            names.set(body, name);
        }
        return name;
    };
}

/**
 * Gmail's page: made by the page's entry, so its state (which compose was
 * last written in) lives in the page, never in the background, which
 * imports this module for the workspace and has no document.
 */
export function createGmailPage(): SitePage {
    const nameOf = namer();
    /** The compose body last written in, while it is still on the page. */
    let lastFocused: Element | undefined;
    document.addEventListener(
        'focusin',
        (event) => {
            const body = event.target instanceof Element ? event.target.closest(BODY) : null;
            if (body !== null) lastFocused = body;
        },
        { capture: true },
    );

    /** The compose being written in: the focused one, else the last focused, else the first one in view. */
    const composeInFront = (): Element | undefined => {
        const active = document.activeElement;
        const focused = active === null ? null : active.closest(BODY);
        if (focused !== null) return focused;
        if (lastFocused?.isConnected === true) return lastFocused;
        return [...document.querySelectorAll(BODY)].find((body) => body.getClientRects().length > 0);
    };

    return {
        id: 'gmail',
        findEditor() {
            const body = composeInFront();
            if (body === undefined) return;
            // Markdown, as for Notion: the client's providers attach to the
            // languages it supports, and a message's formatting is in the DOM.
            return domEditor(body, body, nameOf(body), 'markdown', {
                leaves: (root) => [root],
                isAtom,
                ownsSpellcheck: true,
            });
        },
    };
}
