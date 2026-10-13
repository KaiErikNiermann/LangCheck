// A stand-in for a Notion page, built to the contract the live page showed
// (research/notion-editor.md): a `.notion-frame`, every block inside one
// outer editing host (`div.whenContentEditable`, contenteditable: focusing a
// leaf focuses it, and input events fire on it), one contenteditable leaf
// per block, prose leaves `spellcheck="true"` and the code block "false",
// inline formatting as spans around text nodes, inline code in
// `.notion-inline-code-container`, an equation as a contenteditable="false"
// atom whose text is hidden MathML, and `.notion-dark-theme` on the body.
//
// Like Notion, it keeps its own model of each block and takes edits only
// from `input` events: a DOM change that arrives some other way is not in
// the model, and `rerender()` (Notion re-rendering from its model) wipes it.
// The model is the "server" the tests read.

interface Block {
    readonly kind: 'title' | 'text' | 'heading' | 'code';
    readonly html: string;
}

const PAGES: Readonly<Record<string, readonly Block[]>> = {
    '3f2b8b37e541802f96a1c557a6b01a44': [
        { kind: 'title', html: 'Tests' },
        { kind: 'heading', html: 'Heading with recieve' },
        {
            kind: 'text',
            html: '<span style="font-weight:600">bold teh</span> and <span style="font-style:italic">italic recieve</span> and <div class="notion-inline-code-container" style="display:inline"><span>inline code teh</span></div> plus <span class="notion-text-equation-token" contenteditable="false">e=mc2<span>e=mc^2</span></span> after, teh end.',
        },
        { kind: 'code', html: 'def teh(recieve):\n    return recieve' },
    ],
    aa24b3e9dafd4deb8617a6a09693570f: [
        { kind: 'title', html: 'Other page' },
        { kind: 'text', html: 'Nothing wrong here, only recieve once.' },
    ],
};

const BLOCK_CLASS: Readonly<Record<Block['kind'], string>> = { title: 'text', text: 'text', heading: 'header', code: 'code' };

const frame = document.createElement('div');
frame.className = 'notion-frame';
// Always in the page, empty until a page is peeked (as live).
const peek = document.createElement('div');
peek.className = 'notion-peek-renderer';
document.body.className = 'notion-body dark notion-dark-theme';
document.body.append(frame, peek);

/** The saved text of each leaf, by block id (`<page>-<n>`), for every page drawn. */
const model = new Map<string, string>();

/** The leaf the selection is in: where an input event on the editing host landed. */
function leafOfSelection(): HTMLElement | undefined {
    const node = document.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest<HTMLElement>('[data-content-editable-leaf="true"]') ?? undefined;
}

function render(pageId: string, into: HTMLElement = frame): void {
    // Deleting from a Map while iterating it is defined: the loop sees the rest.
    for (const id of model.keys()) if (id.startsWith(`${pageId}-`)) model.delete(id);
    const blocks = PAGES[pageId] ?? [];
    // As live: one editing host around every block, which takes focus and input.
    const host = document.createElement('div');
    host.className = 'whenContentEditable';
    host.contentEditable = 'true';
    host.addEventListener('input', () => {
        const leaf = leafOfSelection();
        const id = leaf?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
        if (leaf !== undefined && id !== undefined) model.set(id, leaf.textContent);
    });
    into.replaceChildren(host);
    host.append(
        ...blocks.map((block, i) => {
            const element = document.createElement('div');
            const id = `${pageId}-${String(i)}`;
            element.dataset.blockId = id;
            element.className = `notion-selectable notion-${BLOCK_CLASS[block.kind]}-block`;
            const leaf = document.createElement('div');
            leaf.dataset.contentEditableLeaf = 'true';
            leaf.contentEditable = 'true';
            leaf.spellcheck = block.kind !== 'code';
            leaf.setAttribute('spellcheck', String(block.kind !== 'code'));
            leaf.style.whiteSpace = 'break-spaces';
            // Fixed test fixtures, never page input.
            leaf.innerHTML = block.html;
            element.append(leaf);
            model.set(id, leaf.textContent);
            return element;
        }),
    );
}

let current = '3f2b8b37e541802f96a1c557a6b01a44';
render(current);

Object.assign(globalThis, {
    __notion: {
        /** What Notion would have saved for a page (the one in the path by default), per leaf, in block order. */
        saved: (pageId = current) => [...model].filter(([id]) => id.startsWith(`${pageId}-`)).map(([, text]) => text),
        /**
         * Notion re-rendering blocks from its model: unsaved DOM changes are
         * lost. `all` re-renders every block, replacing its text nodes even
         * when nothing changed (as a React re-mount does).
         */
        rerender(all = false) {
            for (const element of document.querySelectorAll<HTMLElement>('[data-block-id]')) {
                const leaf = element.querySelector('[data-content-editable-leaf]');
                const text = model.get(element.dataset.blockId ?? '');
                if (leaf === null || text === undefined) continue;
                // Unsaved text is lost; a re-mount keeps structure but every node is new.
                if (leaf.textContent !== text) leaf.textContent = text;
                else if (all) leaf.replaceChildren(...[...leaf.childNodes].map((node) => node.cloneNode(true)));
            }
        },
        /** Opens `pageId` in a side (`s`) or centre (`c`) peek over the page in the path. */
        peek(pageId: string, mode: 's' | 'c' = 's') {
            history.pushState({}, '', `${location.pathname}?p=${pageId}&pm=${mode}`);
            render(pageId, peek);
        },
        /** Closes the peek: the page in the path is in front again. */
        closePeek() {
            history.pushState({}, '', location.pathname);
            peek.replaceChildren();
        },
        /** Single-page navigation to another page of the same workspace. */
        navigate(pageId: string, workspace = 'test-workspace') {
            current = pageId;
            history.pushState({}, '', `/p/${workspace}/page-${pageId}`);
            render(current);
        },
    },
});
