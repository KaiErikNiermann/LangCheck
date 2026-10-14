// The look of findings, inlay hints, the card and the toast, for every editor.
//
// All literal values live in TOKENS (and DARK_TOKENS, which rebinds colours
// only); the rules below consume them as `--lc-*` custom properties.
// CodeMirror gets everything as a base theme scoped to its editor (`&dark`
// for dark themes); a DOM editor gets the same as a stylesheet (domCss). The
// `lc-` prefix keeps the properties clear of the host page's own.

import type { ActionKind } from './actionKind';

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
    '--lc-font-mono': "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    '--lc-font-size-mono': '12px',
    '--lc-line-height': '1.4',
    '--lc-space-1': '2px',
    '--lc-space-2': '4px',
    '--lc-space-3': '8px',
    '--lc-radius': '4px',
    '--lc-radius-row': '3px',
    '--lc-glyph-width': '2ch',
    '--lc-card-width': '28em',
    '--lc-card-border': '#8886',
    '--lc-card-shadow': '0 2px 8px #0003',
    '--lc-card-bg': '#fff',
    '--lc-card-fg': '#222',
    '--lc-card-muted': '#6e6e6e',
    // The card's action rows, after VS Code's quick-fix list: a tinted row
    // under the pointer, its focus ring for the keyboard, and one accent per
    // kind of action (the editor's string, keyword and variable colours).
    '--lc-row-hover': '#0060c01f',
    '--lc-row-focus': '#0090f1',
    '--lc-kind-fix': '#388a34',
    '--lc-kind-fix-all': '#af00db',
    '--lc-kind-dictionary': '#0070c1',
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
    '--lc-card-muted': '#9d9d9d',
    '--lc-row-hover': '#04395e',
    '--lc-row-focus': '#007fd4',
    '--lc-kind-fix': '#89d185',
    '--lc-kind-fix-all': '#c586c0',
    '--lc-kind-dictionary': '#4fc1ff',
};

/** Each kind of card action (actionKind.ts): its glyph and accent, rebinding the row's private properties. */
const ACTION_KINDS = {
    preferred: { '--_glyph': "'●'", '--_accent': 'var(--lc-kind-fix)', fontWeight: '600' },
    fix: { '--_glyph': "'○'", '--_accent': 'var(--lc-kind-fix)' },
    'fix-all': { '--_glyph': "'≡'", '--_accent': 'var(--lc-kind-fix-all)' },
    dictionary: { '--_glyph': "'+'", '--_accent': 'var(--lc-kind-dictionary)' },
    ignore: { '--_glyph': "'−'", color: 'var(--lc-card-muted)' },
    other: {},
} as const satisfies Record<ActionKind, Declarations>;

const SEVERITY_TOKEN = ['--lc-error', '--lc-warning', '--lc-info', '--lc-info'] as const;

/** How findings and hints look inside an editor that renders marks (CodeMirror). */
const FINDING_RULES: Rules = {
    '.lc-diag': { textDecoration: 'underline wavy', textDecorationSkipInk: 'none', textUnderlineOffset: 'var(--lc-underline-offset)' },
    ...Object.fromEntries(SEVERITY_CLASS.map((cls, i) => [`.${cls}`, { textDecorationColor: `var(${SEVERITY_TOKEN[i] ?? '--lc-info'})` }])),
    // inline-block, so the finding's wavy underline does not run under it.
    // Being a block of its own, it would take the line's text-indent and
    // wrapping as its own: Overleaf hangs wrapped lines (a negative
    // text-indent, overflow-wrap: anywhere), which drew the hint over the
    // next word in a box no wider than its padding. It is one unbroken run.
    '.lc-hint-after::after, .lc-hint-before::before': {
        content: 'attr(data-lc-hint)',
        display: 'inline-block',
        opacity: 'var(--lc-hint-opacity)',
        fontStyle: 'italic',
        paddingInline: 'var(--lc-hint-gap)',
        textIndent: '0',
        whiteSpace: 'pre',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        userSelect: 'none',
        pointerEvents: 'auto',
    },
    // Only the ghost text takes the pointer, not the character it hangs on:
    // the mark is hovered (below) only while the pointer is on the hint.
    '.lc-hint-after, .lc-hint-before': { pointerEvents: 'none' },
    // With Ctrl (Cmd) held, the hint under the pointer reads as a link, as
    // in VS Code; the others stay as they are.
    '&[data-lc-mod] .lc-hint-after:hover::after, &[data-lc-mod] .lc-hint-before:hover::before': {
        cursor: 'pointer',
        textDecoration: 'underline',
    },
};

/**
 * The card and toast; shared by every editor. Separation inside the card is
 * its own gap. A host page styles its own buttons (Overleaf's are
 * Bootstrap's), so an action row sets everything a button inherits from one.
 */
const CARD_RULES: Rules = {
    '.lc-popover': {
        position: 'absolute',
        zIndex: 'var(--lc-z-card)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--lc-space-2)',
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
        lineHeight: 'var(--lc-line-height)',
        whiteSpace: 'normal',
    },
    '.lc-popover[hidden]': { display: 'none' },
    '.lc-popover p': { margin: '0' },
    '.lc-origin': { fontFamily: 'var(--lc-font-mono)', fontSize: 'var(--lc-font-size-mono)', color: 'var(--lc-card-muted)' },
    '.lc-actions': {
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
        paddingBlockStart: 'var(--lc-space-2)',
        borderBlockStart: '1px solid var(--lc-card-border)',
    },
    '.lc-action': {
        '--_glyph': "'·'",
        '--_accent': 'var(--lc-card-muted)',
        display: 'flex',
        alignItems: 'baseline',
        margin: '0',
        paddingBlock: 'var(--lc-space-1)',
        paddingInline: 'var(--lc-space-2)',
        border: '0',
        borderRadius: 'var(--lc-radius-row)',
        background: 'none',
        boxShadow: 'none',
        color: 'inherit',
        fontFamily: 'var(--lc-font-mono)',
        fontSize: 'var(--lc-font-size-mono)',
        fontWeight: 'normal',
        lineHeight: 'inherit',
        letterSpacing: 'normal',
        textAlign: 'start',
        textTransform: 'none',
        cursor: 'pointer',
    },
    '.lc-action:hover, .lc-action:focus-visible': { background: 'var(--lc-row-hover)' },
    '.lc-action:focus-visible': { outline: '1px solid var(--lc-row-focus)', outlineOffset: '-1px' },
    // A span, hidden from assistive tech: a glyph in the button's own
    // ::before would join its accessible name.
    '.lc-glyph': { flex: 'none', inlineSize: 'var(--lc-glyph-width)', color: 'var(--_accent)' },
    '.lc-glyph::before': { content: 'var(--_glyph)' },
    ...Object.fromEntries(Object.entries(ACTION_KINDS).map(([kind, declarations]) => [`.lc-action[data-kind="${kind}"]`, declarations])),
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
