// A stand-in for Gmail's compose, built to what the live page showed
// (research/gmail-editor.md): each compose a `[role="dialog"]` holding one
// `contenteditable` body (`role="textbox"`, `g_editable="true"`, labelled
// "Message Body") with a <div> per line, a quoted message in
// `.gmail_quote` and a signature in `.gmail_signature`. "Full screen" and
// "Exit full screen" resize the same body; nothing is replaced. The server
// sends Gmail's `require-trusted-types-for 'script'`, so the page builds
// everything with DOM calls, and so must anything injected into it.
//
// ?text=line|line (the first compose's lines), ?quote=… (a quoted reply),
// ?composes=2 (a second compose), ?spellcheck=false (the body's attribute),
// ?fixture=formatted (the markup Gmail's toolbar left in a live compose:
// nested <font size>, <b>, &nbsp;, a list in a coloured <font>).

const params = new URLSearchParams(location.search);
const lines = (params.get('text') ?? 'I will recieve teh parcel.|Second line.').split('|');

function element(tag: string, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

/**
 * Lines as a live Gmail compose held them after its size, bold and colour
 * tools (research/gmail-editor.md): words split across <font size> and <b>,
 * sizes nested in sizes, a non-breaking space before a sized word, a list
 * inside a coloured <font>.
 */
function formattedLines(): HTMLElement[] {
    const font = (attributes: Record<string, string>, ...children: (Node | string)[]): HTMLElement => element('font', attributes, ...children);
    return [
        element('div', {}, 'Split by size: re', font({ size: '6' }, 'cie', font({ size: '2' }, 've here.'))),
        element('div', {}, font({ size: '6' }, font({ size: '2' }, element('b', {}, 'Split by bold: te'), 'h end.'))),
        element('div', {}, font({ size: '6' }, font({ size: '2' }, 'Small size:\u{A0}', font({ size: '1' }, 'teh', font({ size: '2' }, '\u{A0}fine.'))))),
        element('div', {}, element('ul', {}, element('li', {}, font({ color: '#d93025', size: '2' }, 'A list item to recieve.')))),
    ];
}

/** A compose window: its dialog, and the body inside it. */
function compose(index: number, body: readonly string[], quote: string | null): { dialog: HTMLElement; body: HTMLElement } {
    const editable = element('div', {
        id: `:b${String(index)}`,
        role: 'textbox',
        'aria-label': 'Message Body',
        g_editable: 'true',
        contenteditable: 'true',
        spellcheck: params.get('spellcheck') ?? 'true',
        class: 'editable',
        style: 'min-height: 200px; outline: none;',
    });
    if (index === 0 && params.get('fixture') === 'formatted') editable.append(...formattedLines());
    else {
        for (const [i, line] of body.entries()) {
            // As Gmail lays a body out: the first line bare, the rest a <div> each.
            if (i === 0) editable.append(line);
            else editable.append(element('div', {}, line === '' ? element('br') : line));
        }
    }
    editable.append(element('div', { class: 'gmail_signature' }, 'Teh signature, not checked.'));
    if (quote !== null) editable.append(element('div', { class: 'gmail_quote' }, element('blockquote', { class: 'gmail_quote' }, quote)));
    const toggle = element('button', { 'aria-label': 'Full screen (Shift for pop-out)', type: 'button' }, 'Full screen');
    const dialog = element('div', { role: 'dialog', class: 'compose', style: 'width: 560px; border: 1px solid #ccc; margin: 8px;' }, toggle, editable);
    toggle.addEventListener('click', () => {
        // The same body, another size: what Gmail's full screen does.
        const full = dialog.dataset.full !== 'true';
        dialog.dataset.full = String(full);
        dialog.style.width = full ? '1020px' : '560px';
        editable.style.minHeight = full ? '520px' : '200px';
        toggle.setAttribute('aria-label', full ? 'Exit full screen (Shift for pop-out)' : 'Full screen (Shift for pop-out)');
    });
    return { dialog, body: editable };
}

const composes = [compose(0, lines, params.get('quote'))];
if (params.get('composes') === '2') composes.push(compose(1, ['Another message with wrod in it.'], null));
document.body.append(...composes.map((c) => c.dialog));

Object.assign(globalThis, {
    __gmail: {
        /** The text of the `n`th compose body, as Gmail would send it, non-breaking spaces as spaces. */
        // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- the lines, as laid out: textContent runs the <div>s together
        text: (n = 0) => (composes[n]?.body.innerText ?? '').replaceAll('\u{A0}', ' '),
        spellcheck: (n = 0) => composes[n]?.body.getAttribute('spellcheck') ?? null,
        fullScreen: (n = 0) => {
            composes[n]?.dialog.querySelector('button')?.click();
        },
        focus: (n = 0) => {
            composes[n]?.body.focus();
        },
    },
});
