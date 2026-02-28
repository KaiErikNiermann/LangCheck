<script lang="ts">
  import { onMount } from 'svelte';

  interface Exclusion {
    startChar: number;
    endChar: number;
    kind: string;
    text: string;
  }

  interface ProseRange {
    startByte: number;
    endByte: number;
    text: string;
    cleanText: string;
    exclusions: Exclusion[];
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

  interface CheckInfo {
    fileName: string;
    fileSize: number;
    languageId: string;
    proseRangeCount: number;
    totalProseBytes: number;
    diagnosticCount: number;
  }

  type Tab = 'extraction' | 'cleantext' | 'latency' | 'diagnostics';

  let proseRanges: ProseRange[] = $state([]);
  let latencyStages: LatencyStage[] = $state([]);
  let diagnosticSummary: DiagnosticSummary | null = $state(null);
  let checkInfo: CheckInfo | null = $state(null);
  let activeTab: Tab = $state('extraction');
  let fileName: string = $state('');
  let languageId: string = $state('');
  let selectedRangeIdx: number | null = $state(null);

  const vscode = (window as any).acquireVsCodeApi();

  onMount(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'setExtraction':
          proseRanges = message.payload.prose ?? [];
          fileName = message.payload.fileName ?? '';
          languageId = message.payload.languageId ?? '';
          selectedRangeIdx = null;
          break;
        case 'setLatency':
          latencyStages = message.payload.stages ?? [];
          break;
        case 'setDiagnosticSummary':
          diagnosticSummary = message.payload;
          break;
        case 'setCheckInfo':
          checkInfo = message.payload;
          break;
      }
    });

    vscode.postMessage({ type: 'inspectorReady' });
  });

  function highlightRange(range: ProseRange, idx: number) {
    selectedRangeIdx = idx;
    vscode.postMessage({
      type: 'highlightRange',
      payload: { startByte: range.startByte, endByte: range.endByte }
    });
  }

  function exclusionKindColor(kind: string): string {
    switch (kind) {
      case 'inline_math': return 'rgba(80, 140, 255, 0.2)';
      case 'display_math': return 'rgba(80, 140, 255, 0.3)';
      case 'command': return 'rgba(160, 100, 220, 0.25)';
      case 'escape': return 'rgba(220, 200, 60, 0.2)';
      case 'comment': return 'rgba(80, 180, 80, 0.2)';
      default: return 'rgba(128, 128, 128, 0.2)';
    }
  }

  function exclusionKindBadgeColor(kind: string): string {
    switch (kind) {
      case 'inline_math':
      case 'display_math': return '#6ca4f8';
      case 'command': return '#c080e0';
      case 'escape': return '#d0c050';
      case 'comment': return '#6ece6e';
      default: return '#aaa';
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  function stageColor(ms: number, total: number): string {
    if (total === 0) return 'var(--vscode-textLink-foreground)';
    const ratio = ms / total;
    if (ratio > 0.5) return 'var(--vscode-editorError-foreground, #f44)';
    if (ratio > 0.25) return 'var(--vscode-editorWarning-foreground, #fa4)';
    return 'var(--vscode-textLink-foreground, #48f)';
  }

  function severityColor(sev: string): string {
    switch (sev) {
      case 'error': return 'var(--vscode-editorError-foreground, #f44)';
      case 'warning': return 'var(--vscode-editorWarning-foreground, #fa4)';
      case 'hint': return 'var(--vscode-editorHint-foreground, #aaa)';
      default: return 'var(--vscode-editorInfo-foreground, #48f)';
    }
  }

  /** Build HTML segments for range text with exclusion zones highlighted. */
  function renderSegments(range: ProseRange): { text: string; isExclusion: boolean; kind: string }[] {
    if (range.exclusions.length === 0) {
      return [{ text: range.text, isExclusion: false, kind: '' }];
    }
    const sorted = [...range.exclusions].sort((a, b) => a.startChar - b.startChar);
    const segments: { text: string; isExclusion: boolean; kind: string }[] = [];
    let pos = 0;
    for (const exc of sorted) {
      if (exc.startChar > pos) {
        segments.push({ text: range.text.substring(pos, exc.startChar), isExclusion: false, kind: '' });
      }
      segments.push({ text: range.text.substring(exc.startChar, exc.endChar), isExclusion: true, kind: exc.kind });
      pos = exc.endChar;
    }
    if (pos < range.text.length) {
      segments.push({ text: range.text.substring(pos), isExclusion: false, kind: '' });
    }
    return segments;
  }
</script>

<main class="panel-root">
  <!-- Tab bar -->
  <nav class="tab-bar">
    <button class="tab" class:active={activeTab === 'extraction'} onclick={() => activeTab = 'extraction'}>
      Extraction
    </button>
    <button class="tab" class:active={activeTab === 'cleantext'} onclick={() => activeTab = 'cleantext'}>
      Clean Text
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
    {#if activeTab === 'extraction'}
      <!-- Extraction Visualizer -->
      {#if proseRanges.length > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">{languageId} extraction</span>
            <span class="section-count">{proseRanges.length} ranges</span>
          </div>
          {#each proseRanges as range, i}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="prose-card"
              class:prose-card-selected={selectedRangeIdx === i}
              onclick={() => highlightRange(range, i)}
            >
              <div class="prose-card-header">
                <span class="prose-label">
                  Range {i + 1}
                  {#if range.exclusions.length > 0}
                    <span class="exclusion-count-badge">{range.exclusions.length} excl.</span>
                  {/if}
                </span>
                <span class="prose-bytes">bytes {range.startByte}..{range.endByte}</span>
              </div>
              <pre class="prose-text">{#each renderSegments(range) as seg}{#if seg.isExclusion}<span class="exc-highlight" style="background: {exclusionKindColor(seg.kind)}" title="{seg.kind}">{seg.text}</span>{:else}{seg.text}{/if}{/each}</pre>
              {#if range.exclusions.length > 0}
                <div class="exclusion-list">
                  {#each range.exclusions as exc}
                    <div class="exclusion-item">
                      <span class="exc-kind-badge" style="color: {exclusionKindBadgeColor(exc.kind)}">{exc.kind}</span>
                      <code class="exc-text">{exc.text.length > 60 ? exc.text.substring(0, 57) + '...' : exc.text}</code>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">Run a check to view extraction data.</div>
      {/if}

    {:else if activeTab === 'cleantext'}
      <!-- Clean Text (what the checker receives) -->
      {#if proseRanges.length > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Checker input</span>
            <span class="section-count">{proseRanges.length} ranges</span>
          </div>
          {#each proseRanges as range, i}
            <div class="clean-text-block">
              <div class="clean-text-header">
                <span class="prose-label">Range {i + 1}</span>
                <span class="prose-bytes">bytes {range.startByte}..{range.endByte}</span>
              </div>
              <pre class="prose-text clean-text">{range.cleanText}</pre>
            </div>
            {#if i < proseRanges.length - 1}
              <div class="range-separator"></div>
            {/if}
          {/each}
        </div>
      {:else}
        <div class="empty-state">Run a check to view clean text.</div>
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
            {#each latencyStages as stage}
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

          <!-- Check Info -->
          {#if checkInfo}
            <div class="section-header" style="margin-top: 16px">
              <span class="section-title">Checked Document</span>
            </div>
            <div class="check-info-grid">
              <div class="check-info-row">
                <span class="check-info-label">File</span>
                <span class="check-info-value">{checkInfo.fileName}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Size</span>
                <span class="check-info-value">{formatBytes(checkInfo.fileSize)}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Language</span>
                <span class="check-info-value">{checkInfo.languageId}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Prose ranges</span>
                <span class="check-info-value">{checkInfo.proseRangeCount}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Prose bytes</span>
                <span class="check-info-value">{formatBytes(checkInfo.totalProseBytes)}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Issues found</span>
                <span class="check-info-value">{checkInfo.diagnosticCount}</span>
              </div>
              <div class="check-info-row">
                <span class="check-info-label">Throughput</span>
                <span class="check-info-value">{total > 0 ? formatBytes(Math.round(checkInfo.fileSize / (total / 1000))) + '/s' : '\u2014'}</span>
              </div>
            </div>
          {/if}
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

  /* -- Tab bar -- */
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

  /* -- Content -- */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  /* -- Shared section styles -- */
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

  /* -- Prose / Extraction cards -- */
  .prose-card {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    border-radius: 6px;
    padding: 10px 12px;
    cursor: pointer;
    transition: border-color 0.1s;
  }

  .prose-card:hover {
    border-color: var(--vscode-focusBorder, rgba(128,128,128,0.4));
  }

  .prose-card-selected {
    border-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground)) !important;
    background: var(--vscode-list-activeSelectionBackground, rgba(0,100,200,0.1));
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
    display: flex;
    align-items: center;
    gap: 6px;
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

  .exclusion-count-badge {
    font-size: 9px;
    padding: 0 5px;
    border-radius: 3px;
    background: rgba(128, 128, 128, 0.2);
    color: var(--vscode-editor-foreground);
    opacity: 0.7;
  }

  .exc-highlight {
    border-radius: 2px;
    padding: 0 1px;
  }

  .exclusion-list {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .exclusion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .exc-kind-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    min-width: 70px;
  }

  .exc-text {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* -- Clean Text tab -- */
  .clean-text-block {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    border-radius: 6px;
    padding: 10px 12px;
  }

  .clean-text-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .clean-text {
    opacity: 0.7;
  }

  .range-separator {
    height: 1px;
    background: var(--vscode-panel-border, rgba(128,128,128,0.15));
    margin: 2px 0;
  }

  /* -- Latency / Flamechart -- */
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

  /* -- Check Info -- */
  .check-info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    padding: 4px 0;
  }

  .check-info-row {
    display: contents;
  }

  .check-info-label {
    font-size: 11px;
    opacity: 0.5;
    white-space: nowrap;
  }

  .check-info-value {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    text-align: right;
  }

  /* -- Diagnostics -- */
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

  /* -- Empty state -- */
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
