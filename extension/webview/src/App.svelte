<script lang="ts">
  import { onMount } from 'svelte';

  interface Diagnostic {
    id: string;
    message: string;
    suggestions: string[];
    text: string;
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
  let allDone = $state(false);

  const vscode = (window as any).acquireVsCodeApi();

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setDiagnostics':
          diagnostics = message.payload;
          allDone = false;
          if (diagnostics.length === 0) {
            allDone = true;
          }
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
        case 'allDone':
          allDone = true;
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  });

  function handleKeydown(event: KeyboardEvent) {
    // Escape always works
    if (event.key === 'Escape') {
      vscode.postMessage({ type: 'close' });
      return;
    }

    if (diagnostics.length === 0) return;

    // Vim-style + arrow navigation for action selection
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      selectedAction = Math.min(selectedAction + 1, actionCount - 1);
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      selectedAction = Math.max(selectedAction - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executeSelectedAction();
    } else if (event.key === 's' || event.key === 'S' || event.key === ' ') {
      event.preventDefault();
      skip();
    } else if (event.key === 'ArrowRight' || event.key === 'l') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft' || event.key === 'h') {
      event.preventDefault();
      prev();
    } else if (event.key >= '1' && event.key <= '9') {
      applyFix(parseInt(event.key) - 1);
    } else if (event.key === '0') {
      applyFix(9);
    } else if (event.key === 'a' || event.key === 'A') {
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
      // Advance after action
      advanceAfterAction();
    }
  }

  function addToDictionary() {
    const diag = diagnostics[currentIndex];
    if (!diag) return;
    // Extract the problematic word from context — it's the text at the diagnostic range
    // For dictionary, we send the word directly (extracted on extension side from context)
    vscode.postMessage({ type: 'addDictionary', payload: { word: getErrorWord() } });
    advanceAfterAction();
  }

  function getErrorWord(): string {
    const diag = diagnostics[currentIndex];
    if (!diag) return '';
    return diag.text;
  }

  function ignore() {
    const diag = diagnostics[currentIndex];
    if (!diag) return;
    vscode.postMessage({ type: 'ignore', payload: { diagnosticId: diag.id } });
    advanceAfterAction();
  }

  function advanceAfterAction() {
    // After an action, the diagnostics list will be updated by the extension.
    // If it was the last item, it stays; otherwise advance.
    if (currentIndex < diagnostics.length - 1) {
      currentIndex++;
    }
  }

  function skip() {
    vscode.postMessage({ type: 'skip' });
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

  function highlightInContext(context: string, errorText: string): string {
    if (!errorText || !context) return escapeHtml(context || '');
    const escaped = escapeHtml(context);
    const escapedWord = escapeHtml(errorText);
    // Highlight first occurrence
    const idx = escaped.indexOf(escapedWord);
    if (idx === -1) return escaped;
    return escaped.substring(0, idx) +
      `<span class="highlight">${escapedWord}</span>` +
      escaped.substring(idx + escapedWord.length);
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
  <div class="loading-bar" class:active={loading}>
    <div class="loading-bar-inner"></div>
  </div>

  <!-- Header -->
  <header class="header">
    <div class="header-top">
      <div class="header-left">
        <div class="progress-text">{diagnostics.length > 0 ? currentIndex + 1 : 0} / {diagnostics.length}</div>
        {#if diagnostics.length > 0}
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progressPercent}%"></div>
          </div>
        {/if}
      </div>
      <div class="shortcuts">
        <kbd>&uarr;&darr;</kbd> select &middot; <kbd>Enter</kbd> apply &middot; <kbd>A</kbd> dict &middot; <kbd>S</kbd> skip &middot; <kbd>&larr;&rarr;</kbd> nav &middot; <kbd>Esc</kbd> close
      </div>
    </div>
  </header>

  {#if allDone && diagnostics.length === 0}
    <!-- All done state -->
    <div class="all-done">
      <div class="all-done-icon">&#10024;</div>
      <div class="all-done-text">All done! No more issues to fix.</div>
      <button class="nav-btn" onclick={() => vscode.postMessage({ type: 'close' })} type="button">
        <kbd class="key-badge">Esc</kbd> Close
      </button>
    </div>
  {:else if diagnostics.length > 0}
    {@const current = diagnostics[currentIndex]}
    <div class="main" class:loading-dim={loading}>
      <!-- File location -->
      <button class="location" onclick={goToLocation} type="button">
        {current.fileName}:{current.lineNumber}
      </button>

      <!-- Error text (the flagged word/phrase) -->
      <div class="error-text">{current.text}</div>

      <!-- Context block with highlight -->
      <div class="context">
        {@html highlightInContext(current.context, current.text)}
      </div>

      <!-- Diagnostic message -->
      <div class="message">{current.message}</div>

      <!-- Action buttons -->
      <div class="actions">
        {#each current.suggestions.slice(0, lowResource ? 3 : current.suggestions.length) as suggestion, i}
          <button
            class="action"
            class:selected={selectedAction === i}
            onclick={() => applyFix(i)}
            type="button"
          >
            {#if i < 10}<span class="key">{i < 9 ? i + 1 : 0}</span>{/if}
            <span class="action-title">{suggestion === '' ? 'Remove text' : suggestion.replace(/^Insert\s+[""\u201C](.+)[""\u201D]$/, 'Insert "$1"')}</span>
          </button>
        {/each}
        {#if lowResource && current.suggestions.length > 3}
          <div class="more-hint">+{current.suggestions.length - 3} more (keys 4-9)</div>
        {/if}

        <button
          class="action"
          class:selected={selectedAction === current.suggestions.length}
          onclick={addToDictionary}
          type="button"
        >
          <span class="key">A</span>
          <span class="action-title">Add to Dictionary</span>
        </button>

        <button
          class="action"
          class:selected={selectedAction === current.suggestions.length + 1}
          onclick={ignore}
          type="button"
        >
          <span class="key">I</span>
          <span class="action-title">Ignore</span>
        </button>
      </div>

      <!-- Navigation -->
      <div class="nav-buttons">
        <button class="nav-btn" onclick={skip} type="button"><kbd>S</kbd>Skip</button>
        <button class="nav-btn" onclick={prev} disabled={currentIndex === 0} type="button"><kbd>&larr;</kbd>Previous</button>
        <button class="nav-btn" onclick={next} disabled={currentIndex >= diagnostics.length - 1} type="button"><kbd>&rarr;</kbd>Next</button>
        <button class="nav-btn" onclick={refresh} type="button"><kbd>R</kbd>Refresh</button>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      {#if loading}
        Checking...
      {:else}
        Open a document and run a check to see issues here.
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

  * { box-sizing: border-box; }

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
    width: 100%;
    height: 3px;
    background: transparent;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 1000;
  }

  .loading-bar.active {
    opacity: 1;
  }

  .loading-bar-inner {
    position: absolute;
    top: 0;
    left: 0;
    width: 30%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--vscode-textLink-foreground, var(--vscode-focusBorder)), transparent);
    animation: loading-slide 1s ease-in-out infinite;
  }

  @keyframes loading-slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .loading-dim {
    opacity: 0.6;
    pointer-events: none;
  }

  /* ── Header ── */
  .header {
    padding: 12px 20px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    flex-shrink: 0;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .progress-text {
    font-size: 14px;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    font-variant-numeric: tabular-nums;
  }

  .progress-bar {
    width: 100px;
    height: 4px;
    background: var(--vscode-progressBar-background, var(--vscode-focusBorder));
    opacity: 0.2;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
    border-radius: 2px;
    transition: width 0.2s;
  }

  .shortcuts {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    opacity: 0.7;
  }

  .shortcuts kbd {
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
  }

  /* ── Main content ── */
  .main {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .location {
    font-size: 12px;
    color: var(--vscode-textLink-foreground);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-family: var(--vscode-editor-font-family, monospace);
    text-decoration: none;
  }

  .location:hover {
    text-decoration: underline;
  }

  .error-text {
    font-size: 24px;
    font-weight: bold;
    color: var(--vscode-errorForeground, var(--vscode-editorError-foreground, #f44));
    word-break: break-word;
    line-height: 1.3;
  }

  .context {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 14px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    padding: 12px 16px;
    border-radius: 6px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .context :global(.highlight) {
    background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,0.33));
    border-bottom: 2px solid var(--vscode-errorForeground, #f44);
  }

  .message {
    font-size: 14px;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
  }

  /* ── Actions ── */
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    font-size: 14px;
    font-family: var(--vscode-font-family);
    transition: all 0.1s;
  }

  .action:hover, .action:focus {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
    outline: none;
  }

  .action.selected {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }

  .action.selected:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    flex-shrink: 0;
    color: var(--vscode-keybindingLabel-foreground, var(--vscode-editor-foreground));
  }

  .action-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .key-badge {
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    font-family: var(--vscode-font-family);
  }

  .more-hint {
    font-size: 11px;
    opacity: 0.4;
    text-align: center;
    padding: 2px 0;
  }

  /* ── Navigation ── */
  .nav-buttons {
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid var(--vscode-panel-border, transparent);
  }

  .nav-btn {
    padding: 8px 16px;
    background: transparent;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-family: var(--vscode-font-family);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .nav-btn kbd {
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.15));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.25));
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
  }

  /* ── All done state ── */
  .all-done {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .all-done-icon {
    font-size: 48px;
  }

  .all-done-text {
    font-size: 18px;
    color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
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
