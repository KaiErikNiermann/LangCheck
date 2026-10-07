// The look of findings, the card and the toast, defined once. CodeMirror
// takes it as a base theme (scoped to its editor, `&dark` for dark themes);
// a DOM editor gets the same rules as a stylesheet (cardCss).

type Rules = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Severity -> class, in `vscode.DiagnosticSeverity` order. */
export const SEVERITY_CLASS = ['lc-error', 'lc-warning', 'lc-info', 'lc-hint'] as const;
export const SEVERITY_COLOR = ['#d33', '#d80', 'steelblue', 'steelblue'] as const;

/** The card and toast; shared by every editor. */
export const CARD_RULES: Rules = {
    '.lc-popover': {
        position: 'absolute',
        zIndex: '200',
        maxWidth: '28em',
        padding: '6px 8px',
        border: '1px solid #8886',
        borderRadius: '4px',
        background: '#fff',
        color: '#222',
        boxShadow: '0 2px 8px #0003',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        whiteSpace: 'normal',
    },
    '.lc-popover p': { margin: '0 0 4px' },
    '.lc-action': { display: 'block', margin: '2px 0', font: 'inherit', cursor: 'pointer' },
    '.lc-toast': {
        position: 'absolute',
        insetBlockEnd: '8px',
        insetInlineEnd: '8px',
        zIndex: '200',
        padding: '4px 8px',
        borderRadius: '4px',
        background: '#333',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
    },
};

/** Dark-theme overrides, by selector, for whichever way an editor marks dark mode. */
export const CARD_DARK_RULES: Rules = {
    '.lc-popover': { background: '#252526', color: '#ddd' },
};

const kebab = (property: string): string => property.replaceAll(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);

/** `rules` as CSS text, each selector prefixed with `scope` (e.g. `@media (...)` handled by the caller). */
export function toCss(rules: Rules, prefix = ''): string {
    return Object.entries(rules)
        .map(([selector, declarations]) => {
            const body = Object.entries(declarations)
                .map(([property, value]) => `${kebab(property)}: ${value};`)
                .join(' ');
            const scoped = selector
                .split(',')
                .map((s) => `${prefix}${s.trim()}`)
                .join(', ');
            return `${scoped} { ${body} }`;
        })
        .join('\n');
}
