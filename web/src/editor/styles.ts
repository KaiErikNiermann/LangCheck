// The look of findings, inlay hints, the card and the toast, for every editor.
//
// All literal values live in TOKENS (and DARK_TOKENS, which rebinds colours
// only); the rules below consume them as `--lc-*` custom properties.
// CodeMirror gets everything as a base theme scoped to its editor (`&dark`
// for dark themes); a DOM editor gets the same as a stylesheet (domCss). The
// `lc-` prefix keeps the properties clear of the host page's own.

type Declarations = Readonly<Record<string, string>>;
type Rules = Readonly<Record<string, Declarations>>;

/** Severity -> class and highlight name, in `vscode.DiagnosticSeverity` order. */
export const SEVERITY_CLASS = ['lc-error', 'lc-warning', 'lc-info', 'lc-hint'] as const;

/** The token table: every literal in the extension's styling. */
const TOKENS: Declarations = {
    '--lc-error': '#d33',
    '--lc-warning': '#d80',
    '--lc-info': 'steelblue',
    '--lc-underline-offset': '3px',
    '--lc-hint-opacity': '0.6',
    '--lc-hint-gap': '0.3em',
    '--lc-font': 'system-ui, sans-serif',
    '--lc-font-size': '13px',
    '--lc-space-1': '2px',
    '--lc-space-2': '4px',
    '--lc-space-3': '8px',
    '--lc-radius': '4px',
    '--lc-card-width': '28em',
    '--lc-card-border': '#8886',
    '--lc-card-shadow': '0 2px 8px #0003',
    '--lc-card-bg': '#fff',
    '--lc-card-fg': '#222',
    '--lc-toast-bg': '#333',
    '--lc-toast-fg': '#fff',
    '--lc-toast-inset': '16px',
    // Inside an editor the card only has to clear the editor's own layers.
    '--lc-z-card': '200',
    // Over a third-party page (a DOM editor, the toast host) there is no
    // stacking context of ours to isolate in: the page's overlays can sit
    // anywhere, so the card takes the top of the stack. The one deliberate
    // escalation (PC-4), bound here once.
    '--lc-z-top': '2147483000',
};

const DARK_TOKENS: Declarations = {
    '--lc-card-bg': '#252526',
    '--lc-card-fg': '#ddd',
};

const SEVERITY_TOKEN = ['--lc-error', '--lc-warning', '--lc-info', '--lc-info'] as const;

/** How findings and hints look inside an editor that renders marks (CodeMirror). */
const FINDING_RULES: Rules = {
    '.lc-diag': { textDecoration: 'underline wavy', textDecorationSkipInk: 'none', textUnderlineOffset: 'var(--lc-underline-offset)' },
    ...Object.fromEntries(SEVERITY_CLASS.map((cls, i) => [`.${cls}`, { textDecorationColor: `var(${SEVERITY_TOKEN[i] ?? '--lc-info'})` }])),
    // inline-block, so the finding's wavy underline does not run under it.
    '.lc-hint-after::after, .lc-hint-before::before': {
        content: 'attr(data-lc-hint)',
        display: 'inline-block',
        opacity: 'var(--lc-hint-opacity)',
        fontStyle: 'italic',
        paddingInline: 'var(--lc-hint-gap)',
        pointerEvents: 'none',
        userSelect: 'none',
    },
};

/** The card and toast; shared by every editor. Separation inside the card is its own gap. */
const CARD_RULES: Rules = {
    '.lc-popover': {
        position: 'absolute',
        zIndex: 'var(--lc-z-card)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--lc-space-1)',
        maxInlineSize: 'var(--lc-card-width)',
        paddingBlock: 'var(--lc-space-2)',
        paddingInline: 'var(--lc-space-3)',
        border: '1px solid var(--lc-card-border)',
        borderRadius: 'var(--lc-radius)',
        background: 'var(--lc-card-bg)',
        color: 'var(--lc-card-fg)',
        boxShadow: 'var(--lc-card-shadow)',
        fontFamily: 'var(--lc-font)',
        fontSize: 'var(--lc-font-size)',
        whiteSpace: 'normal',
    },
    '.lc-popover[hidden]': { display: 'none' },
    '.lc-popover p': { margin: '0' },
    '.lc-action': { font: 'inherit', cursor: 'pointer' },
    '.lc-toast': {
        position: 'absolute',
        insetBlockEnd: 'var(--lc-space-3)',
        insetInlineEnd: 'var(--lc-space-3)',
        zIndex: 'var(--lc-z-card)',
        // Its own width, not its container's: positioned in the corner of
        // a host with no size (a DOM editor's), it shrank to one word a line.
        inlineSize: 'max-content',
        maxInlineSize: 'var(--lc-card-width)',
        paddingBlock: 'var(--lc-space-2)',
        paddingInline: 'var(--lc-space-3)',
        borderRadius: 'var(--lc-radius)',
        background: 'var(--lc-toast-bg)',
        color: 'var(--lc-toast-fg)',
        fontFamily: 'var(--lc-font)',
        fontSize: 'var(--lc-font-size)',
    },
};

/** The base theme for a CodeMirror editor: tokens on the editor root, then the rules. */
export const CM6_THEME: Rules = {
    '&': TOKENS,
    '&dark': DARK_TOKENS,
    ...FINDING_RULES,
    ...CARD_RULES,
};

const kebab = (property: string): string => (property.startsWith('--') ? property : property.replaceAll(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`));

/** `rules` as CSS text. */
function toCss(rules: Rules): string {
    return Object.entries(rules)
        .map(([selector, declarations]) => {
            const body = Object.entries(declarations)
                .map(([property, value]) => `${kebab(property)}: ${value};`)
                .join(' ');
            return `${selector} { ${body} }`;
        })
        .join('\n');
}

/**
 * The stylesheet for a DOM editor (Notion): tokens on the document, findings
 * as CSS highlights (named after SEVERITY_CLASS), the card on the page's top
 * layer, and the toast in a fixed host.
 */
export function domCss(darkSelector: string | undefined): string {
    const highlights = Object.fromEntries(
        SEVERITY_CLASS.map((name, i) => [
            `::highlight(${name})`,
            {
                textDecoration: `underline wavy var(${SEVERITY_TOKEN[i] ?? '--lc-info'})`,
                textDecorationSkipInk: 'none',
                textUnderlineOffset: 'var(--lc-underline-offset)',
            },
        ]),
    );
    return toCss({
        ':root': TOKENS,
        ...(darkSelector !== undefined && { [darkSelector]: DARK_TOKENS }),
        ...highlights,
        ...CARD_RULES,
        'body > .lc-popover': { zIndex: 'var(--lc-z-top)' },
        '.lc-toast-host': { position: 'fixed', insetBlockEnd: 'var(--lc-toast-inset)', insetInlineEnd: 'var(--lc-toast-inset)', zIndex: 'var(--lc-z-top)' },
    });
}
