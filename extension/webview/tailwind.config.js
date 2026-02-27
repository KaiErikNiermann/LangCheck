/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./inspector.html",
    "./src/**/*.{svelte,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          'editor-bg': 'var(--vscode-editor-background)',
          'editor-fg': 'var(--vscode-editor-foreground)',
          'button-bg': 'var(--vscode-button-background)',
          'button-hover-bg': 'var(--vscode-button-hoverBackground)',
          'button-fg': 'var(--vscode-button-foreground)',
          'input-bg': 'var(--vscode-input-background)',
          'input-fg': 'var(--vscode-input-foreground)',
          'input-border': 'var(--vscode-input-border)',
          'focus-border': 'var(--vscode-focusBorder)',
          'list-hover-bg': 'var(--vscode-list-hoverBackground)',
          'list-active-selection-bg': 'var(--vscode-list-activeSelectionBackground)',
          'list-active-selection-fg': 'var(--vscode-list-activeSelectionForeground)',
          'badge-bg': 'var(--vscode-badge-background)',
          'badge-fg': 'var(--vscode-badge-foreground)',
        }
      },
      spacing: {
        'panel': '1rem',       // Standard panel padding
        'card': '1rem',        // Card inner padding
      },
      borderRadius: {
        'card': '0.375rem',    // Consistent card rounding
      },
      fontSize: {
        'label': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.05em' }],
      },
    },
  },
  plugins: [],
}
