<script lang="ts">
  import { onMount } from 'svelte';

  interface Diagnostic {
    id: string;
    message: string;
    suggestions: string[];
    context: string;
    ruleId: string;
  }

  let diagnostics: Diagnostic[] = $state([]);
  let currentIndex = $state(0);
  let lowResource = $state(false);

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setDiagnostics':
          diagnostics = message.payload;
          currentIndex = 0;
          break;
        case 'setLowResource':
          lowResource = message.payload;
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  });

  const vscode = (window as any).acquireVsCodeApi();

  function handleKeydown(event: KeyboardEvent) {
    if (diagnostics.length === 0) return;

    if (event.key >= '1' && event.key <= '9') {
      applyFix(parseInt(event.key) - 1);
    } else if (event.key === 'a') {
      addToDictionary();
    } else if (event.key === 'i') {
      ignore();
    } else if (event.key === ' ') {
      next();
      event.preventDefault();
    }
  }

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
    vscode.postMessage({ type: 'addDictionary', payload: diagnostics[currentIndex].id });
    next();
  }

  function ignore() {
    vscode.postMessage({ type: 'ignore', payload: diagnostics[currentIndex].id });
    next();
  }

  function next() {
    if (currentIndex < diagnostics.length - 1) currentIndex++;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="panel-root p-panel" class:low-resource={lowResource}>
  <header class="panel-header mb-4">
    <h1 class="text-lg font-bold">
      SpeedFix
      {#if lowResource}<span class="text-xs opacity-40 font-normal ml-1">LR</span>{/if}
    </h1>
    <div class="text-sm opacity-70">{currentIndex + 1} / {diagnostics.length}</div>
  </header>

  {#if diagnostics.length > 0}
    {@const current = diagnostics[currentIndex]}
    <div class="flex-1 flex flex-col gap-6 overflow-y-auto">
      <div class="card">
        <div class="label mb-1">{current.ruleId}</div>
        <div class="{lowResource ? 'text-base' : 'text-xl'} mb-4">{current.message}</div>
        <div class="code-block italic">"...{current.context}..."</div>
      </div>

      <div class="grid gap-2">
        <div class="label mb-1">Suggestions</div>
        {#each current.suggestions.slice(0, lowResource ? 3 : current.suggestions.length) as suggestion, i}
          <button
            class="btn-primary {lowResource ? 'no-transition' : 'group'}"
            onclick={() => applyFix(i)}
          >
            <span>{suggestion}</span>
            <span class="{lowResource ? 'opacity-50' : 'opacity-50 group-hover:opacity-100'} text-xs bg-black/20 px-1 rounded">{i + 1}</span>
          </button>
        {/each}
        {#if lowResource && current.suggestions.length > 3}
          <div class="text-xs opacity-40 text-center">+{current.suggestions.length - 3} more (use keyboard 4-9)</div>
        {/if}
      </div>

      <div class="mt-auto grid grid-cols-3 gap-2 text-center text-xs opacity-70">
        <div class="p-2 bordered"><kbd class="kbd">A</kbd> Add to Dict</div>
        <div class="p-2 bordered"><kbd class="kbd">I</kbd> Ignore</div>
        <div class="p-2 bordered"><kbd class="kbd">Space</kbd> Skip</div>
      </div>
    </div>
  {:else}
    <div class="empty-state">No language issues found in the current scope.</div>
  {/if}
</main>

<style>
  :global(body) { overflow: hidden; }
  .low-resource :global(*) {
    transition: none !important;
    animation: none !important;
  }
  .no-transition { transition: none; }
</style>
