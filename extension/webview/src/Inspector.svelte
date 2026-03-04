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
    englishEngine: string;
  }

  interface PipelineEvent {
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    source: string;
    message: string;
    durationMs?: number;
    details?: string;
  }

  interface EngineHealth {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    consecutiveFailures: number;
    lastError: string;
    lastSuccessEpochMs: number;
  }

  type Tab = 'extraction' | 'cleantext' | 'latency' | 'diagnostics' | 'events' | 'health';

  let proseRanges: ProseRange[] = $state([]);
  let latencyStages: LatencyStage[] = $state([]);
  let diagnosticSummary: DiagnosticSummary | null = $state(null);
  let checkInfo: CheckInfo | null = $state(null);
  let events: PipelineEvent[] = $state([]);
  let engineHealth: EngineHealth[] = $state([]);
  let dockerAvailable = $state(false);
  let activeTab: Tab = $state('extraction');
  let fileName: string = $state('');
  let languageId: string = $state('');
  let selectedRangeIdx: number | null = $state(null);
  let extensionVersion: string = $state('');
  let copyFeedback: boolean = $state(false);
  const MAX_EVENTS = 200;
  const REPORT_EVENT_CAP = 20;

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
        case 'pushEvent':
          events = [...events.slice(-(MAX_EVENTS - 1)), message.payload];
          break;
        case 'clearEvents':
          events = [];
          break;
        case 'setEngineHealth':
          engineHealth = message.payload ?? [];
          break;
        case 'setDockerAvailable':
          dockerAvailable = message.payload;
          break;
        case 'setExtensionVersion':
          extensionVersion = message.payload;
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
      case 'link': return 'rgba(80, 200, 180, 0.2)';
      case 'delimiter': return 'rgba(180, 140, 100, 0.2)';
      case 'whitespace': return 'rgba(128, 128, 128, 0.1)';
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
      case 'link': return '#50c8b4';
      case 'delimiter': return '#c0a070';
      case 'whitespace': return '#888';
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

  function eventLevelColor(level: string): string {
    switch (level) {
      case 'error': return 'var(--vscode-editorError-foreground, #f44)';
      case 'warn': return 'var(--vscode-editorWarning-foreground, #fa4)';
      case 'debug': return 'var(--vscode-editorHint-foreground, #aaa)';
      default: return 'var(--vscode-textLink-foreground, #48f)';
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function healthStatusColor(status: string): string {
    switch (status) {
      case 'ok': return 'var(--vscode-testing-iconPassed, #4caf50)';
      case 'degraded': return 'var(--vscode-editorWarning-foreground, #fa4)';
      case 'down': return 'var(--vscode-editorError-foreground, #f44)';
      default: return 'var(--vscode-editorHint-foreground, #aaa)';
    }
  }

  function formatTimeSince(epochMs: number): string {
    if (epochMs === 0) return 'never';
    const seconds = Math.floor((Date.now() - epochMs) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function hasUnhealthyEngine(): boolean {
    return engineHealth.some(e => e.status !== 'ok');
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

  function generateReport(includeText: boolean): string {
    const lines: string[] = ['## Language Check Inspector Report', ''];

    // Document
    if (checkInfo || fileName) {
      lines.push('### Document');
      if (checkInfo) {
        lines.push(`- **File:** ${checkInfo.fileName}`);
        lines.push(`- **Language:** ${checkInfo.languageId}`);
        lines.push(`- **Size:** ${formatBytes(checkInfo.fileSize)}`);
        lines.push(`- **English engine:** ${checkInfo.englishEngine}`);
      } else {
        if (fileName) lines.push(`- **File:** ${fileName}`);
        if (languageId) lines.push(`- **Language:** ${languageId}`);
      }
      lines.push('');
    }

    // Diagnostics
    if (diagnosticSummary && diagnosticSummary.total > 0) {
      lines.push(`### Diagnostics (${diagnosticSummary.total} issues)`, '');
      lines.push('| Severity | Count |', '|---|---|');
      for (const s of diagnosticSummary.bySeverity) {
        lines.push(`| ${s.severity} | ${s.count} |`);
      }
      lines.push('');
      lines.push('| Rule | Count |', '|---|---|');
      for (const r of diagnosticSummary.byRule) {
        lines.push(`| ${r.ruleId} | ${r.count} |`);
      }
      lines.push('');
    }

    // Extraction
    if (proseRanges.length > 0) {
      const totalProseBytes = proseRanges.reduce((sum, r) => sum + (r.endByte - r.startByte), 0);
      const exclusionCounts = new Map<string, number>();
      for (const r of proseRanges) {
        for (const e of r.exclusions) {
          exclusionCounts.set(e.kind, (exclusionCounts.get(e.kind) ?? 0) + 1);
        }
      }
      lines.push('### Extraction');
      lines.push(`- **Prose ranges:** ${proseRanges.length}`);
      lines.push(`- **Total prose bytes:** ${totalProseBytes}`);
      if (exclusionCounts.size > 0) {
        const parts = [...exclusionCounts.entries()].map(([k, v]) => `${v} ${k}`);
        lines.push(`- Exclusions: ${parts.join(', ')}`);
      }
      lines.push('');
    }

    // Timing
    if (latencyStages.length > 0) {
      lines.push('### Timing', '');
      lines.push('| Stage | Duration |', '|---|---|');
      for (const s of latencyStages) {
        lines.push(`| ${s.name} | ${formatDuration(s.durationMs)} |`);
      }
      lines.push('');
    }

    // Engine Health
    if (engineHealth.length > 0) {
      lines.push('### Engine Health', '');
      lines.push('| Engine | Status | Details |', '|---|---|---|');
      for (const e of engineHealth) {
        const details = e.status !== 'ok'
          ? `${e.consecutiveFailures} failures${e.lastError ? `, last: ${e.lastError.substring(0, 60)}` : ''}`
          : '';
        lines.push(`| ${e.name} | ${e.status} | ${details} |`);
      }
      lines.push('');
    }

    // Recent Events
    if (events.length > 0) {
      const capped = events.slice(-REPORT_EVENT_CAP);
      lines.push('### Recent Events');
      lines.push('```');
      for (const evt of capped) {
        const time = formatTime(evt.timestamp);
        const dur = evt.durationMs !== undefined ? ` (${formatDuration(evt.durationMs)})` : '';
        lines.push(`[${time}] ${evt.level} ${evt.source}: ${evt.message}${dur}`);
      }
      lines.push('```');
      lines.push('');
    }

    // Environment
    lines.push('### Environment');
    if (extensionVersion) lines.push(`- Extension: ${extensionVersion}`);
    lines.push('');

    // Optional document text
    if (includeText && proseRanges.length > 0) {
      lines.push('### Document Text');
      lines.push('<details><summary>Prose ranges (click to expand)</summary>', '');
      for (let i = 0; i < proseRanges.length; i++) {
        const r = proseRanges[i];
        lines.push(`Range ${i} (bytes ${r.startByte}-${r.endByte}):`);
        lines.push('```');
        lines.push(r.text);
        lines.push('```');
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }

    return lines.join('\n');
  }

  async function copyReport() {
    const report = generateReport(false);
    await navigator.clipboard.writeText(report);
    copyFeedback = true;
    setTimeout(() => { copyFeedback = false; }, 2000);
  }

  function reportIssue() {
    const ok = confirm(
      'The inspector report will be used to pre-fill a GitHub issue. ' +
      'It includes file names, diagnostics, and timing data but NOT your document text. ' +
      'This information will be publicly visible. Continue?'
    );
    if (!ok) return;
    const body = generateReport(false);
    vscode.postMessage({ type: 'openIssue', payload: { body } });
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
    <button class="tab" class:active={activeTab === 'events'} onclick={() => activeTab = 'events'}>
      Events{events.length > 0 ? ` (${events.length})` : ''}
    </button>
    <button class="tab" class:active={activeTab === 'health'} class:tab-health-warn={hasUnhealthyEngine()} onclick={() => activeTab = 'health'}>
      Health
    </button>
    {#if fileName}
      <span class="tab-filename">{fileName}</span>
    {/if}
  </nav>

  <!-- Report toolbar -->
  <div class="report-toolbar">
    <button class="health-action-btn" onclick={copyReport}>
      {copyFeedback ? 'Copied!' : 'Copy Report'}
    </button>
    <button class="health-action-btn" onclick={reportIssue}>
      Report Issue
    </button>
  </div>

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
                <span class="check-info-label">English engine</span>
                <span class="check-info-value engine-badge">{checkInfo.englishEngine}</span>
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

    {:else if activeTab === 'events'}
      <!-- Event Log -->
      {#if events.length > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Pipeline Events</span>
            <button class="clear-btn" onclick={() => events = []}>Clear</button>
          </div>
          <div class="event-log">
            {#each [...events].reverse() as evt}
              <div class="event-row" class:event-error={evt.level === 'error'} class:event-warn={evt.level === 'warn'}>
                <span class="event-time">{formatTime(evt.timestamp)}</span>
                <span class="event-level-dot" style="background: {eventLevelColor(evt.level)}" title={evt.level}></span>
                <span class="event-source">{evt.source}</span>
                <span class="event-msg">{evt.message}</span>
                {#if evt.durationMs !== undefined}
                  <span class="event-duration">{formatDuration(evt.durationMs)}</span>
                {/if}
                {#if evt.details}
                  <span class="event-details" title={evt.details}>{evt.details}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty-state">No events captured yet. Interact with the extension to see pipeline events.</div>
      {/if}

    {:else if activeTab === 'health'}
      <!-- Engine Health -->
      {#if engineHealth.length > 0}
        <div class="section-list">
          <div class="section-header">
            <span class="section-title">Engine Health</span>
            <span class="section-count">{engineHealth.length} engines</span>
          </div>

          <div class="health-grid">
            {#each engineHealth as engine}
              <div class="health-card" class:health-card-warn={engine.status === 'degraded'} class:health-card-error={engine.status === 'down'}>
                <div class="health-card-header">
                  <span class="health-dot" style="background: {healthStatusColor(engine.status)}"></span>
                  <span class="health-name">{engine.name}</span>
                  <span class="health-status" style="color: {healthStatusColor(engine.status)}">{engine.status}</span>
                </div>
                {#if engine.status !== 'ok'}
                  <div class="health-details">
                    <div class="health-detail-row">
                      <span class="health-detail-label">Failures</span>
                      <span class="health-detail-value">{engine.consecutiveFailures}</span>
                    </div>
                    {#if engine.lastError}
                      <div class="health-detail-row">
                        <span class="health-detail-label">Error</span>
                        <span class="health-detail-value health-error-text" title={engine.lastError}>
                          {engine.lastError.length > 80 ? engine.lastError.substring(0, 77) + '...' : engine.lastError}
                        </span>
                      </div>
                    {/if}
                    <div class="health-detail-row">
                      <span class="health-detail-label">Last OK</span>
                      <span class="health-detail-value">{formatTimeSince(engine.lastSuccessEpochMs)}</span>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          {#if hasUnhealthyEngine()}
            <div class="health-actions">
              <button class="health-action-btn" onclick={() => vscode.postMessage({ type: 'healthCheckLT' })}>
                Health Check
              </button>
              {#if dockerAvailable}
                <button class="health-action-btn health-action-restart" onclick={() => vscode.postMessage({ type: 'restartLTDocker' })}>
                  Restart Docker
                </button>
              {/if}
            </div>
          {:else}
            <div class="health-ok-banner">All engines operational</div>
          {/if}
        </div>
      {:else}
        <div class="empty-state">Run a check to see engine health status.</div>
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

  /* -- Report toolbar -- */
  .report-toolbar {
    display: flex;
    gap: 8px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    flex-shrink: 0;
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

  .engine-badge {
    text-transform: capitalize;
    color: var(--vscode-textLink-foreground, #48f);
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

  /* -- Event Log -- */
  .event-log {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .event-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: 3px;
    line-height: 1.4;
    min-height: 22px;
  }

  .event-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08));
  }

  .event-error {
    background: rgba(255, 60, 60, 0.08);
  }

  .event-warn {
    background: rgba(255, 170, 60, 0.06);
  }

  .event-time {
    opacity: 0.35;
    font-size: 10px;
    min-width: 80px;
    flex-shrink: 0;
  }

  .event-level-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .event-source {
    color: var(--vscode-textLink-foreground, #48f);
    min-width: 100px;
    flex-shrink: 0;
    font-weight: 600;
    font-size: 10px;
  }

  .event-msg {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }

  .event-duration {
    opacity: 0.5;
    flex-shrink: 0;
    min-width: 55px;
    text-align: right;
  }

  .event-details {
    opacity: 0.3;
    font-size: 10px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clear-btn {
    border: none;
    background: transparent;
    color: var(--vscode-textLink-foreground, #48f);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    font-family: var(--vscode-font-family);
  }

  .clear-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.15));
  }

  /* -- Health tab -- */
  .tab-health-warn {
    color: var(--vscode-editorWarning-foreground, #fa4) !important;
    opacity: 0.9 !important;
  }

  .health-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .health-card {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    border-radius: 6px;
    padding: 10px 12px;
  }

  .health-card-warn {
    border-color: rgba(255, 170, 60, 0.3);
    background: rgba(255, 170, 60, 0.05);
  }

  .health-card-error {
    border-color: rgba(255, 60, 60, 0.3);
    background: rgba(255, 60, 60, 0.05);
  }

  .health-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .health-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .health-name {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
    text-transform: capitalize;
  }

  .health-status {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .health-details {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .health-detail-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    font-size: 11px;
  }

  .health-detail-label {
    opacity: 0.5;
    flex-shrink: 0;
    min-width: 60px;
  }

  .health-detail-value {
    font-family: var(--vscode-editor-font-family, monospace);
    text-align: right;
    word-break: break-all;
  }

  .health-error-text {
    color: var(--vscode-editorError-foreground, #f44);
    opacity: 0.8;
  }

  .health-actions {
    display: flex;
    gap: 8px;
    padding-top: 8px;
  }

  .health-action-btn {
    border: 1px solid var(--vscode-button-border, var(--vscode-panel-border, rgba(128,128,128,0.3)));
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
  }

  .health-action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
  }

  .health-action-restart {
    background: var(--vscode-button-background, #0078d4);
    color: var(--vscode-button-foreground, #fff);
    border-color: transparent;
  }

  .health-action-restart:hover {
    background: var(--vscode-button-hoverBackground, #026ec1);
  }

  .health-ok-banner {
    text-align: center;
    padding: 12px;
    font-size: 12px;
    opacity: 0.5;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    margin-top: 4px;
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
