<script lang="ts">
  import { onMount } from 'svelte';

  interface Diagnostic {
    id: string;
    message: string;
    suggestions: string[];
    context: string;
    ruleId: string;
    fileName: string;
    lineNumber: number;
  }

  let diagnostics: Diagnostic[] = $state([]);
  let currentIndex = $state(0);
  let lowResource = $state(false);
  let loading = $state(false);
  let selectedAction = $state(0);

  const vscode = (window as any).acquireVsCodeApi();

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setDiagnostics':
          diagnostics = message.payload;
          if (currentIndex >= diagnostics.length) {
            currentIndex = Math.max(0, diagnostics.length - 1);
          }
          selectedAction = 0;
          break;
        case 'setLowResource':
          lowResource = message.payload;
          break;
        case 'loading':
          loading = message.payload;
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  });

  function handleKeydown(event: KeyboardEvent) {
    if (diagnostics.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const maxActions = actionCount;
      selectedAction = Math.min(selectedAction + 1, maxActions - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedAction = Math.max(selectedAction - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executeSelectedAction();
    } else if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prev();
    } else if (event.key >= '1' && event.key <= '9') {
      applyFix(parseInt(event.key) - 1);
    } else if (event.key === 'a') {
      addToDictionary();
    } else if (event.key === 'i') {
      ignore();
    } else if (event.key === 'r' || event.key === 'R') {
      refresh();
    }
  }

  $effect(() => {
    // Reset selected action when switching diagnostics
    currentIndex;
    selectedAction = 0;
  });

  function executeSelectedAction() {
    const current = diagnostics[currentIndex];
    if (!current) return;
    const sugCount = current.suggestions.length;
    if (selectedAction < sugCount) {
      applyFix(selectedAction);
    } else if (selectedAction === sugCount) {
      addToDictionary();
    } else if (selectedAction === sugCount + 1) {
      ignore();
    }
  }

  let actionCount = $derived.by(() => {
    const current = diagnostics[currentIndex];
    if (!current) return 0;
    return current.suggestions.length + 2; // +2 for Add to Dict and Ignore
  });

  function applyFix(suggestionIndex: number) {
    const diag = diagnostics[currentIndex];
    if (diag && diag.suggestions[suggestionIndex]) {
      vscode.postMessage({
        type: 'applyFix',
        payload: { diagnosticId: diag.id, suggestion: diag.suggestions[suggestionIndex] }
      });
      next();
    }
  }

  function addToDictionary() {
    const diag = diagnostics[currentIndex];
    if (!diag) return;
    vscode.postMessage({ type: 'addDictionary', payload: { diagnosticId: diag.context } });
    next();
  }

  function ignore() {
    const diag = diagnostics[currentIndex];
    if (!diag) return;
    vscode.postMessage({ type: 'ignore', payload: { diagnosticId: diag.id } });
    next();
  }

  function next() {
    if (currentIndex < diagnostics.length - 1) {
      currentIndex++;
    }
  }

  function prev() {
    if (currentIndex > 0) {
      currentIndex--;
    }
  }

  function refresh() {
    vscode.postMessage({ type: 'refresh' });
  }

  function goToLocation() {
    const diag = diagnostics[currentIndex];
    if (!diag) return;
    vscode.postMessage({ type: 'goToLocation', payload: { diagnosticId: diag.id } });
  }

  function highlightInContext(context: string, word: string): string {
    if (!word) return escapeHtml(context);
    const escaped = escapeHtml(context);
    const escapedWord = escapeHtml(word);
    return escaped.replace(
      escapedWord,
      `<span class="highlight">${escapedWord}</span>`
    );
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let progressPercent = $derived(
    diagnostics.length > 0 ? ((currentIndex + 1) / diagnostics.length) * 100 : 0
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="panel-root" class:low-resource={lowResource}>
  <!-- Loading bar -->
  {#if loading}
    <div class="loading-bar">
      <div class="loading-bar-inner"></div>
    </div>
  {/if}

  <!-- Header -->
  <header class="header">
    <div class="header-top">
      <h1 class="title">SpeedFix</h1>
      <div class="counter">{diagnostics.length > 0 ? currentIndex + 1 : 0} / {diagnostics.length}</div>
    </div>
    {#if diagnostics.length > 0}
      <div class="progress-track">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
    {/if}
    <div class="shortcuts-legend">
      <span class="legend-item"><kbd>&#8593;&#8595;</kbd> Select</span>
      <span class="legend-item"><kbd>Enter</kbd> Apply</span>
      <span class="legend-item"><kbd>&#8592;&#8594;</kbd> Nav</span>
      <span class="legend-item"><kbd>R</kbd> Refresh</span>
    </div>
  </header>

  {#if diagnostics.length > 0}
    {@const current = diagnostics[currentIndex]}

    <div class="content">
      <!-- File location -->
      <button class="file-location" onclick={goToLocation} type="button">
        {current.fileName}:{current.lineNumber}
      </button>

      <!-- Error text -->
      <div class="error-text">{current.context}</div>

      <!-- Context block -->
      <div class="context-block">
        {@html highlightInContext(`...${current.context}...`, current.context)}
      </div>

      <!-- Diagnostic message -->
      <div class="diag-message">
        <span class="rule-badge">{current.ruleId}</span>
        {current.message}
      </div>

      <!-- Action buttons -->
      <div class="actions">
        {#each current.suggestions.slice(0, lowResource ? 3 : current.suggestions.length) as suggestion, i}
          <button
            class="action-btn"
            class:action-selected={selectedAction === i}
            onclick={() => applyFix(i)}
            type="button"
          >
            <span class="action-label">{suggestion}</span>
            <kbd class="key-badge">{i + 1}</kbd>
          </button>
        {/each}
        {#if lowResource && current.suggestions.length > 3}
          <div class="more-hint">+{current.suggestions.length - 3} more (keys 4-9)</div>
        {/if}

        <button
          class="action-btn action-secondary"
          class:action-selected={selectedAction === current.suggestions.length}
          onclick={addToDictionary}
          type="button"
        >
          <span class="action-label">Add to Dictionary</span>
          <kbd class="key-badge">A</kbd>
        </button>

        <button
          class="action-btn action-secondary"
          class:action-selected={selectedAction === current.suggestions.length + 1}
          onclick={ignore}
          type="button"
        >
          <span class="action-label">Ignore</span>
          <kbd class="key-badge">I</kbd>
        </button>
      </div>

      <!-- Navigation -->
      <nav class="nav-bar">
        <button class="nav-btn" onclick={prev} disabled={currentIndex === 0} type="button">
          <kbd class="key-badge">&#8592;</kbd> Previous
        </button>
        <button class="nav-btn" onclick={next} disabled={currentIndex >= diagnostics.length - 1} type="button">
          Next <kbd class="key-badge">&#8594;</kbd>
        </button>
        <button class="nav-btn" onclick={refresh} type="button">
          <kbd class="key-badge">R</kbd> Refresh
        </button>
      </nav>
    </div>
  {:else}
    <div class="empty-state">
      {#if loading}
        Checking...
      {:else}
        No language issues found.
      {/if}
    </div>
  {/if}
</main>

<style>
  :global(body) {
    overflow: hidden;
    margin: 0;
    padding: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }

  .low-resource :global(*) {
    transition: none !important;
    animation: none !important;
  }

  .panel-root {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  /* ── Loading bar ── */
  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    overflow: hidden;
    z-index: 10;
  }

  .loading-bar-inner {
    height: 100%;
    width: 40%;
    background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    animation: loading-slide 1.2s ease-in-out infinite;
  }

  @keyframes loading-slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  /* ── Header ── */
  .header {
    padding: 12px 16px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
    background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
    flex-shrink: 0;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-titleBar-activeForeground, var(--vscode-editor-foreground));
  }

  .counter {
    font-size: 12px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .progress-track {
    height: 3px;
    background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    opacity: 0.2;
    border-radius: 2px;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    opacity: 1;
    border-radius: 2px;
    transition: width 0.2s ease;
  }

  .shortcuts-legend {
    display: flex;
    gap: 12px;
    font-size: 11px;
    opacity: 0.5;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .legend-item kbd {
    font-size: 10px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    color: var(--vscode-keybindingLabel-foreground, var(--vscode-editor-foreground));
    font-family: var(--vscode-font-family);
    line-height: 1.4;
  }

  /* ── Content ── */
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    overflow-y: auto;
  }

  .file-location {
    font-size: 11px;
    color: var(--vscode-textLink-foreground);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-family: var(--vscode-editor-font-family, monospace);
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .file-location:hover {
    color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
  }

  .error-text {
    font-size: 18px;
    font-weight: 600;
    color: var(--vscode-errorForeground, var(--vscode-editorError-foreground, #f44));
    word-break: break-word;
    line-height: 1.3;
  }

  .context-block {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    padding: 8px 12px;
    border-radius: 4px;
    line-height: 1.5;
    color: var(--vscode-editor-foreground);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .context-block :global(.highlight) {
    background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,0.33));
    border-radius: 2px;
    padding: 0 1px;
  }

  .diag-message {
    font-size: 12px;
    line-height: 1.4;
    opacity: 0.8;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .rule-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    color: var(--vscode-badge-foreground, var(--vscode-editor-foreground));
    flex-shrink: 0;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* ── Actions ── */
  .actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--vscode-font-family);
    text-align: left;
    transition: background 0.1s, border-color 0.1s;
  }

  .action-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .action-btn.action-selected {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .action-secondary {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
  }

  .action-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
  }

  .action-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .key-badge {
    font-size: 11px;
    min-width: 18px;
    text-align: center;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    color: var(--vscode-keybindingLabel-foreground, var(--vscode-editor-foreground));
    font-family: var(--vscode-font-family);
    line-height: 1.3;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .more-hint {
    font-size: 11px;
    opacity: 0.4;
    text-align: center;
    padding: 2px 0;
  }

  /* ── Navigation ── */
  .nav-bar {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    margin-top: auto;
    border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
  }

  .nav-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-editor-foreground);
    cursor: pointer;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    transition: background 0.1s;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .nav-btn .key-badge {
    font-size: 10px;
    padding: 0 3px;
    min-width: auto;
    margin-left: 0;
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
    font-size: 13px;
  }
</style>
