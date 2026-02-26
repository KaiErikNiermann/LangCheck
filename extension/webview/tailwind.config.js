/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
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
        }
      }
    },
  },
  plugins: [],
}
