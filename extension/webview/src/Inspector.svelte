<script lang="ts">
  import { onMount } from 'svelte';

  interface ASTNode {
    kind: string;
    startByte: number;
    endByte: number;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    children: ASTNode[];
  }

  interface ProseRange {
    startByte: number;
    endByte: number;
    text: string;
  }

  interface IgnoreRange {
    startByte: number;
    endByte: number;
    ruleIds: string[];
    kind: string;
  }

  interface LatencyStage {
    name: string;
    durationMs: number;
  }

  type Tab = 'ast' | 'prose' | 'latency';

  let ast: ASTNode | null = $state(null);
  let proseRanges: ProseRange[] = $state([]);
  let ignoreRanges: IgnoreRange[] = $state([]);
  let latencyStages: LatencyStage[] = $state([]);
  let activeTab: Tab = $state('ast');
  let expandedNodes = $state(new Set<string>());
  let hoveredNode: ASTNode | null = $state(null);
  let fileName: string = $state('');

  const vscode = (window as any).acquireVsCodeApi();

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setAST':
          ast = message.payload.ast;
          fileName = message.payload.fileName ?? '';
          // Auto-expand root
          if (ast) expandedNodes.add(nodeKey(ast, '0'));
          break;
        case 'setProseRanges':
          proseRanges = message.payload.prose ?? [];
          ignoreRanges = message.payload.ignores ?? [];
          break;
        case 'setLatency':
          latencyStages = message.payload.stages ?? [];
          break;
      }
    });

    vscode.postMessage({ type: 'inspectorReady' });
  });

  function nodeKey(node: ASTNode, path: string): string {
    return `${path}:${node.kind}:${node.startByte}`;
  }

  function toggleNode(key: string) {
    if (expandedNodes.has(key)) {
      expandedNodes.delete(key);
    } else {
      expandedNodes.add(key);
    }
    expandedNodes = new Set(expandedNodes);
  }

  function highlightRange(node: ASTNode) {
    vscode.postMessage({
      type: 'highlightRange',
      payload: {
        startByte: node.startByte,
        endByte: node.endByte,
      }
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}\u00b5s`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function totalLatency(): number {
    return latencyStages.reduce((sum, s) => sum + s.durationMs, 0);
  }

  function barWidth(ms: number): number {
    const total = totalLatency();
    if (total === 0) return 0;
    return Math.max(2, (ms / total) * 100);
  }
</script>

<main class="h-screen flex flex-col bg-vscode-editor-bg text-vscode-editor-fg overflow-hidden">
  <!-- Tab bar -->
  <nav class="flex border-b border-vscode-input-border text-sm">
    <button
      class="px-4 py-2 border-b-2 transition-colors"
      class:border-vscode-focus-border={activeTab === 'ast'}
      class:border-transparent={activeTab !== 'ast'}
      class:opacity-50={activeTab !== 'ast'}
      onclick={() => activeTab = 'ast'}
    >AST</button>
    <button
      class="px-4 py-2 border-b-2 transition-colors"
      class:border-vscode-focus-border={activeTab === 'prose'}
      class:border-transparent={activeTab !== 'prose'}
      class:opacity-50={activeTab !== 'prose'}
      onclick={() => activeTab = 'prose'}
    >Prose Extraction</button>
    <button
      class="px-4 py-2 border-b-2 transition-colors"
      class:border-vscode-focus-border={activeTab === 'latency'}
      class:border-transparent={activeTab !== 'latency'}
      class:opacity-50={activeTab !== 'latency'}
      onclick={() => activeTab = 'latency'}
    >Latency</button>
    {#if fileName}
      <span class="ml-auto px-4 py-2 text-xs opacity-50 truncate">{fileName}</span>
    {/if}
  </nav>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-3">
    {#if activeTab === 'ast'}
      <!-- AST Visualizer -->
      {#if ast}
        <div class="font-mono text-xs leading-relaxed">
          {#snippet treeNode(node: ASTNode, path: string, depth: number)}
            {@const key = nodeKey(node, path)}
            {@const expanded = expandedNodes.has(key)}
            {@const hasChildren = node.children && node.children.length > 0}
            {@const isProse = proseRanges.some(r => r.startByte <= node.startByte && r.endByte >= node.endByte)}
            {@const isIgnored = ignoreRanges.some(r => r.startByte <= node.startByte && r.endByte >= node.endByte)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="flex items-start gap-1 py-0.5 rounded hover:bg-vscode-list-hover-bg cursor-pointer {isProse && !isIgnored ? 'prose-highlight' : ''} {isIgnored ? 'ignore-highlight' : ''}"
              role="treeitem"
              aria-selected="false"
              style="padding-left: {depth * 16}px"
              onmouseenter={() => hoveredNode = node}
              onmouseleave={() => hoveredNode = null}
              onclick={() => { if (hasChildren) toggleNode(key); highlightRange(node); }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (hasChildren) toggleNode(key); highlightRange(node); } }}
              tabindex="0"
            >
              {#if hasChildren}
                <span class="opacity-50 w-3 flex-shrink-0">{expanded ? '\u25BC' : '\u25B6'}</span>
              {:else}
                <span class="w-3 flex-shrink-0"></span>
              {/if}
              <span class="text-vscode-button-bg font-bold">{node.kind}</span>
              <span class="opacity-40 ml-1">[{node.startLine}:{node.startCol}..{node.endLine}:{node.endCol}]</span>
              {#if isProse && !isIgnored}
                <span class="ml-1 px-1 rounded text-[10px] bg-green-800/50 text-green-300">prose</span>
              {/if}
              {#if isIgnored}
                <span class="ml-1 px-1 rounded text-[10px] bg-yellow-800/50 text-yellow-300">ignored</span>
              {/if}
            </div>
            {#if expanded && hasChildren}
              {#each node.children as child, i}
                {@render treeNode(child, `${path}.${i}`, depth + 1)}
              {/each}
            {/if}
          {/snippet}
          {@render treeNode(ast, '0', 0)}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full opacity-50 text-sm">
          Open a document to view its syntax tree.
        </div>
      {/if}

    {:else if activeTab === 'prose'}
      <!-- Prose Extraction Trace -->
      {#if proseRanges.length > 0 || ignoreRanges.length > 0}
        <div class="space-y-3">
          <h2 class="text-xs uppercase opacity-50 mb-2">Extracted Prose Ranges ({proseRanges.length})</h2>
          {#each proseRanges as range, i}
            <div class="bg-vscode-input-bg p-3 rounded border border-vscode-input-border">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs opacity-50">Range {i + 1}</span>
                <span class="text-xs opacity-40">bytes {range.startByte}..{range.endByte}</span>
              </div>
              <pre class="font-mono text-xs whitespace-pre-wrap bg-black/20 p-2 rounded">{range.text}</pre>
            </div>
          {/each}

          {#if ignoreRanges.length > 0}
            <h2 class="text-xs uppercase opacity-50 mb-2 mt-4">Ignore Directives ({ignoreRanges.length})</h2>
            {#each ignoreRanges as range, i}
              <div class="bg-yellow-900/10 p-3 rounded border border-yellow-800/30">
                <div class="flex justify-between items-center mb-1">
                  <span class="text-xs text-yellow-300">{range.kind}</span>
                  <span class="text-xs opacity-40">bytes {range.startByte}..{range.endByte}</span>
                </div>
                {#if range.ruleIds.length > 0}
                  <div class="text-xs opacity-60 mt-1">
                    Rules: {range.ruleIds.join(', ')}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full opacity-50 text-sm">
          No prose ranges extracted yet.
        </div>
      {/if}

    {:else if activeTab === 'latency'}
      <!-- Latency Profiler -->
      {#if latencyStages.length > 0}
        <div class="space-y-3">
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-xs uppercase opacity-50">Pipeline Stages</h2>
            <span class="text-xs font-mono opacity-60">Total: {formatDuration(totalLatency())}</span>
          </div>
          {#each latencyStages as stage}
            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span>{stage.name}</span>
                <span class="font-mono opacity-60">{formatDuration(stage.durationMs)}</span>
              </div>
              <div class="h-2 bg-vscode-input-bg rounded overflow-hidden">
                <div
                  class="h-full bg-vscode-button-bg rounded transition-all"
                  style="width: {barWidth(stage.durationMs)}%"
                ></div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full opacity-50 text-sm">
          Run a document check to see latency breakdown.
        </div>
      {/if}
    {/if}
  </div>
</main>

<style>
  .prose-highlight { background-color: rgba(0, 100, 0, 0.2); }
  .ignore-highlight { background-color: rgba(100, 100, 0, 0.2); }
</style>
