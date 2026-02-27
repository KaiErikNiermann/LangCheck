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

  interface DiagnosticSummary {
    total: number;
    byRule: { ruleId: string; count: number }[];
    bySeverity: { severity: string; count: number }[];
  }

  type Tab = 'ast' | 'prose' | 'latency' | 'diagnostics';

  let ast: ASTNode | null = $state(null);
  let proseRanges: ProseRange[] = $state([]);
  let ignoreRanges: IgnoreRange[] = $state([]);
  let latencyStages: LatencyStage[] = $state([]);
  let diagnosticSummary: DiagnosticSummary | null = $state(null);
  let activeTab: Tab = $state('ast');
  let expandedNodes = $state(new Set<string>());
  let hoveredNode: ASTNode | null = $state(null);
  let selectedNode: ASTNode | null = $state(null);
  let fileName: string = $state('');

  const vscode = (window as any).acquireVsCodeApi();

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setAST':
          ast = message.payload.ast;
          fileName = message.payload.fileName ?? '';
          if (ast) expandedNodes.add(nodeKey(ast, '0'));
          break;
        case 'setProseRanges':
          proseRanges = message.payload.prose ?? [];
          ignoreRanges = message.payload.ignores ?? [];
          break;
        case 'setLatency':
          latencyStages = message.payload.stages ?? [];
          break;
        case 'setDiagnosticSummary':
          diagnosticSummary = message.payload;
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

  function selectAndHighlight(node: ASTNode) {
    selectedNode = node;
    vscode.postMessage({
      type: 'highlightRange',
      payload: { startByte: node.startByte, endByte: node.endByte }
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 0.001) return '<1\u00b5s';
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

  // Color for latency bars — hot path highlighting
  function stageColor(ms: number, total: number): string {
    if (total === 0) return 'var(--vscode-textLink-foreground)';
    const ratio = ms / total;
    if (ratio > 0.5) return 'var(--vscode-editorError-foreground, #f44)';
    if (ratio > 0.25) return 'var(--vscode-editorWarning-foreground, #fa4)';
    return 'var(--vscode-textLink-foreground, #48f)';
  }

  // Badge color for severity
  function severityColor(sev: string): string {
    switch (sev) {
      case 'error': return 'var(--vscode-editorError-foreground, #f44)';
      case 'warning': return 'var(--vscode-editorWarning-foreground, #fa4)';
      case 'hint': return 'var(--vscode-editorHint-foreground, #aaa)';
      default: return 'var(--vscode-editorInfo-foreground, #48f)';
    }
  }

  // Node kind badge colors
  function kindColor(kind: string): string {
    switch (kind) {
      case 'document': return '#888';
      case 'heading': return '#d7ba7d';
      case 'paragraph': return '#9cdcfe';
      case 'code_fence': return '#ce9178';
      case 'list_item': return '#c586c0';
      case 'block_quote': return '#6a9955';
      case 'blank_line': return '#555';
      default: return '#ddd';
    }
  }
</script>

<main class="panel-root">
  <!-- Tab bar -->
  <nav class="tab-bar">
    <button class="tab" class:active={activeTab === 'ast'} onclick={() => activeTab = 'ast'}>
      AST
    </button>
    <button class="tab" class:active={activeTab === 'prose'} onclick={() => activeTab = 'prose'}>
      Prose
    </button>
    <button class="tab" class:active={activeTab === 'latency'} onclick={() => activeTab = 'latency'}>
      Timing
    </button>
    <button class="tab" class:active={activeTab === 'diagnostics'} onclick={() => activeTab = 'diagnostics'}>
      Issues
    </button>
    {#if fileName}
      <span class="tab-filename">{fileName}</span>
    {/if}
  </nav>

  <!-- Content -->
  <div class="content">
    {#if activeTab === 'ast'}
      <!-- AST Visualizer -->
      {#if ast}
        <div class="tree" role="tree">
          {#snippet treeNode(node: ASTNode, path: string, depth: number)}
            {@const key = nodeKey(node, path)}
            {@const expanded = expandedNodes.has(key)}
            {@const hasChildren = node.children && node.children.length > 0}
            {@const isProse = proseRanges.some(r => r.startByte <= node.startByte && r.endByte >= node.endByte)}
            {@const isIgnored = ignoreRanges.some(r => r.startByte <= node.startByte && r.endByte >= node.endByte)}
            {@const isSelected = selectedNode === node}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="tree-row"
              class:tree-row-selected={isSelected}
              class:tree-row-hovered={hoveredNode === node}
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={hasChildren ? expanded : undefined}
              style="padding-left: {depth * 20 + 8}px"
              onmouseenter={() => hoveredNode = node}
              onmouseleave={() => hoveredNode = null}
              onclick={() => { if (hasChildren) toggleNode(key); selectAndHighlight(node); }}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (hasChildren) toggleNode(key); selectAndHighlight(node); } }}
              tabindex="0"
            >
              <!-- Indentation guides -->
              {#each Array(depth) as _, d}
                <span class="indent-guide" style="left: {d * 20 + 14}px"></span>
              {/each}

              {#if hasChildren}
                <span class="chevron">{expanded ? '\u25BE' : '\u25B8'}</span>
              {:else}
                <span class="chevron-spacer"></span>
              {/if}
              <span class="node-kind" style="color: {kindColor(node.kind)}">{node.kind}</span>
              <span class="node-range">[{node.startLine}:{node.startCol}..{node.endLine}:{node.endCol}]</span>
              {#if isProse && !isIgnored}
                <span class="badge badge-prose">prose</span>
              {/if}
              {#if isIgnored}
                <span class="badge badge-ignored">ignored</span>
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
        <div class="empty-state">Open a document to view its syntax tree.</div>
      {/if}

    {:else if activeTab === 'prose'}
      <!-- Prose Extraction -->
      {#if proseRanges.length > 0 || ignoreRanges.length > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Extracted Prose Ranges</span>
            <span class="section-count">{proseRanges.length}</span>
          </div>
          {#each proseRanges as range, i}
            <div class="prose-card">
              <div class="prose-card-header">
                <span class="prose-label">Range {i + 1}</span>
                <span class="prose-bytes">bytes {range.startByte}..{range.endByte}</span>
              </div>
              <pre class="prose-text">{range.text}</pre>
            </div>
          {/each}

          {#if ignoreRanges.length > 0}
            <div class="section-header" style="margin-top: 16px">
              <span class="section-title">Ignore Directives</span>
              <span class="section-count">{ignoreRanges.length}</span>
            </div>
            {#each ignoreRanges as range, i}
              <div class="ignore-card">
                <div class="prose-card-header">
                  <span class="ignore-kind">{range.kind}</span>
                  <span class="prose-bytes">bytes {range.startByte}..{range.endByte}</span>
                </div>
                {#if range.ruleIds.length > 0}
                  <div class="ignore-rules">Rules: {range.ruleIds.join(', ')}</div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="empty-state">No prose ranges extracted yet.</div>
      {/if}

    {:else if activeTab === 'latency'}
      <!-- Latency Profiler / Flamechart -->
      {#if latencyStages.length > 0}
        {@const total = totalLatency()}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Check Pipeline</span>
            <span class="section-total">{formatDuration(total)}</span>
          </div>

          <!-- Flamechart-style stacked bar -->
          <div class="flamechart">
            {#each latencyStages as stage, i}
              {@const w = barWidth(stage.durationMs)}
              <div
                class="flame-segment"
                style="width: {w}%; background: {stageColor(stage.durationMs, total)}"
                title="{stage.name}: {formatDuration(stage.durationMs)}"
              ></div>
            {/each}
          </div>

          <!-- Detailed breakdown -->
          {#each latencyStages as stage}
            <div class="latency-row">
              <div class="latency-label">
                <span class="latency-dot" style="background: {stageColor(stage.durationMs, total)}"></span>
                <span>{stage.name}</span>
              </div>
              <div class="latency-bar-container">
                <div
                  class="latency-bar"
                  style="width: {barWidth(stage.durationMs)}%; background: {stageColor(stage.durationMs, total)}"
                ></div>
              </div>
              <span class="latency-value">{formatDuration(stage.durationMs)}</span>
            </div>
          {/each}

          <!-- Percentage breakdown -->
          <div class="latency-summary">
            {#each latencyStages as stage}
              <span class="latency-pct">
                {stage.name}: {total > 0 ? ((stage.durationMs / total) * 100).toFixed(0) : 0}%
              </span>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty-state">Run a document check to see timing breakdown.</div>
      {/if}

    {:else if activeTab === 'diagnostics'}
      <!-- Diagnostic Summary -->
      {#if diagnosticSummary && diagnosticSummary.total > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Issue Summary</span>
            <span class="section-count">{diagnosticSummary.total} total</span>
          </div>

          <!-- Severity breakdown -->
          <div class="diag-grid">
            {#each diagnosticSummary.bySeverity as item}
              <div class="diag-sev-card">
                <span class="diag-sev-dot" style="background: {severityColor(item.severity)}"></span>
                <span class="diag-sev-label">{item.severity}</span>
                <span class="diag-sev-count">{item.count}</span>
              </div>
            {/each}
          </div>

          <!-- Rule breakdown -->
          <div class="section-header" style="margin-top: 16px">
            <span class="section-title">By Rule</span>
          </div>
          {#each diagnosticSummary.byRule as item}
            <div class="rule-row">
              <span class="rule-id">{item.ruleId}</span>
              <div class="rule-bar-container">
                <div
                  class="rule-bar"
                  style="width: {(item.count / diagnosticSummary.total) * 100}%"
                ></div>
              </div>
              <span class="rule-count">{item.count}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">No diagnostics reported yet.</div>
      {/if}
    {/if}
  </div>
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

  * { box-sizing: border-box; }

  .panel-root {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Tab bar ── */
  .tab-bar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
    flex-shrink: 0;
  }

  .tab {
    padding: 8px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--vscode-foreground, var(--vscode-editor-foreground));
    opacity: 0.5;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    transition: opacity 0.1s, border-color 0.1s;
  }

  .tab:hover {
    opacity: 0.8;
  }

  .tab.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
  }

  .tab-filename {
    margin-left: auto;
    padding: 8px 16px;
    font-size: 11px;
    opacity: 0.4;
    font-family: var(--vscode-editor-font-family, monospace);
    align-self: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Content ── */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  /* ── AST Tree ── */
  .tree {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.6;
    padding: 4px 0;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 1px;
    padding-bottom: 1px;
    padding-right: 12px;
    cursor: pointer;
    position: relative;
    white-space: nowrap;
  }

  .tree-row:hover, .tree-row-hovered {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
  }

  .tree-row-selected {
    background: var(--vscode-list-activeSelectionBackground, rgba(0,100,200,0.3)) !important;
    color: var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground));
  }

  .indent-guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,0.2));
  }

  .chevron {
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    opacity: 0.6;
    font-size: 10px;
  }

  .chevron-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .node-kind {
    font-weight: 600;
  }

  .node-range {
    opacity: 0.35;
    font-size: 11px;
    margin-left: 4px;
  }

  .badge {
    font-size: 9px;
    padding: 0 5px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-left: 4px;
  }

  .badge-prose {
    background: rgba(0, 150, 0, 0.25);
    color: #6ece6e;
  }

  .badge-ignored {
    background: rgba(180, 150, 0, 0.25);
    color: #e0c050;
  }

  /* ── Prose Extraction ── */
  .section-list {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.5;
    font-weight: 600;
  }

  .section-count {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    color: var(--vscode-badge-foreground, var(--vscode-editor-foreground));
  }

  .section-total {
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    opacity: 0.6;
  }

  .prose-card {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    border-radius: 6px;
    padding: 10px 12px;
  }

  .prose-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .prose-label {
    font-size: 11px;
    opacity: 0.5;
  }

  .prose-bytes {
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    opacity: 0.35;
  }

  .prose-text {
    margin: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    opacity: 0.8;
  }

  .ignore-card {
    background: rgba(180, 150, 0, 0.06);
    border: 1px solid rgba(180, 150, 0, 0.2);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .ignore-kind {
    font-size: 11px;
    color: #e0c050;
  }

  .ignore-rules {
    font-size: 11px;
    opacity: 0.5;
    margin-top: 4px;
  }

  /* ── Latency / Flamechart ── */
  .flamechart {
    display: flex;
    height: 24px;
    border-radius: 4px;
    overflow: hidden;
    gap: 1px;
    background: var(--vscode-panel-border, rgba(128,128,128,0.15));
  }

  .flame-segment {
    height: 100%;
    min-width: 2px;
    opacity: 0.85;
    transition: opacity 0.1s;
  }

  .flame-segment:hover {
    opacity: 1;
  }

  .latency-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
  }

  .latency-label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 140px;
    flex-shrink: 0;
  }

  .latency-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .latency-bar-container {
    flex: 1;
    height: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border-radius: 3px;
    overflow: hidden;
  }

  .latency-bar {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s;
  }

  .latency-value {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    opacity: 0.6;
    min-width: 60px;
    text-align: right;
  }

  .latency-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding-top: 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
  }

  .latency-pct {
    font-size: 10px;
    opacity: 0.4;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* ── Diagnostics ── */
  .diag-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .diag-sev-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
  }

  .diag-sev-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .diag-sev-label {
    font-size: 12px;
    text-transform: capitalize;
  }

  .diag-sev-count {
    font-size: 14px;
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .rule-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }

  .rule-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    min-width: 140px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
  }

  .rule-bar-container {
    flex: 1;
    height: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border-radius: 3px;
    overflow: hidden;
  }

  .rule-bar {
    height: 100%;
    background: var(--vscode-textLink-foreground, #48f);
    border-radius: 3px;
    transition: width 0.3s;
  }

  .rule-count {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    opacity: 0.6;
    min-width: 30px;
    text-align: right;
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    opacity: 0.4;
    font-size: 13px;
  }
</style>
