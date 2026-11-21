/**
 * Timing, summarising and recording for the end-to-end benchmarks: VS
 * Code's (this directory) and the browser extension's (web/test/bench),
 * which share this file and the corpus.
 *
 * These are sanity benchmarks, not a regression gate: a check's wall time
 * depends on the machine, what else it is doing and the VS Code build, so a
 * tight bound would trip on noise. Each metric is sampled several times and
 * reported as a median with its spread; the only gate is a ceiling an order
 * of magnitude above what a normal run takes, which only something broken --
 * a quadratic walk, a hang, a retry storm -- reaches.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** How many measured repetitions each metric gets, after one discarded warm-up. */
export const REPS = Number(process.env.BENCH_REPS ?? 5);

export interface Summary {
    readonly median: number;
    readonly min: number;
    readonly max: number;
    /** $\frac{\max - \min}{\text{median}}$: how far one run can be from another. */
    readonly spread: number;
}

export function summarize(samples: readonly number[]): Summary {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
        ? sorted[mid] as number
        : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
    const min = sorted[0] as number;
    const max = sorted[sorted.length - 1] as number;
    return { median, min, max, spread: median > 0 ? (max - min) / median : 0 };
}

/** Wall time of `run`, in milliseconds, with what it returned. */
export async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
    const start = performance.now();
    const value = await run();
    return { ms: performance.now() - start, value };
}

/** What a metric's samples count: wall time, memory held, or a number of things (listeners, open files). */
export type Unit = 'ms' | 'MiB' | 'count';

export interface Metric {
    /** The document or workspace shape, e.g. "large-1mb". */
    readonly subject: string;
    /** What was measured, e.g. "cold check". */
    readonly metric: string;
    /** Milliseconds unless `unit` says otherwise. */
    readonly unit?: Unit;
    readonly samples: readonly number[];
    /** The median past which something is broken rather than slow, in the metric's unit. */
    readonly ceiling: number;
    /** What the subject was, for reading the numbers: a size, a file count. */
    readonly detail?: string;
}

interface Row extends Metric, Summary {}

/**
 * Collects a suite's metrics, appends each to a JSONL file as it lands, and
 * prints a table at the end.
 *
 * Appended one line per metric rather than written once, so a run that dies
 * halfway -- the case that hung is the interesting one -- keeps what it had.
 */
export class Recorder {
    private readonly rows: Row[] = [];
    private readonly file: string;

    constructor(private readonly suite: string) {
        const dir = process.env.BENCH_OUT ?? path.join(os.tmpdir(), 'language-check-bench');
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, 'results.jsonl');
    }

    record(metric: Metric): Summary {
        const summary = summarize(metric.samples);
        this.rows.push({ ...metric, ...summary });
        fs.appendFileSync(this.file, `${JSON.stringify({
            at: new Date().toISOString(),
            commit: process.env.BENCH_COMMIT ?? '',
            host: { cpu: os.cpus()[0]?.model ?? '', cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30) },
            suite: this.suite,
            unit: 'ms',
            ...metric,
            ...summary,
        })}\n`);
        return summary;
    }

    /** Fail a metric whose median passed its ceiling, unless BENCH_GATE=off. */
    gate(): void {
        if (process.env.BENCH_GATE === 'off') return;
        const broken = this.rows.filter(row => row.median > row.ceiling);
        if (broken.length > 0) {
            throw new Error(`past the ceiling: ${broken
                .map(row => `${row.subject} ${row.metric} ${show(row.median, row.unit)} > ${show(row.ceiling, row.unit)}`)
                .join('; ')}`);
        }
    }

    /** The suite's metrics as a table, for the run's output. */
    table(): string {
        const header = ['subject', 'metric', 'n', 'median', 'min', 'max', 'spread', 'ceiling', 'detail'];
        const body = this.rows.map(row => [
            row.subject, row.metric, String(row.samples.length),
            show(row.median, row.unit), show(row.min, row.unit), show(row.max, row.unit), `${(row.spread * 100).toFixed(0)}%`,
            show(row.ceiling, row.unit), row.detail ?? '',
        ]);
        const widths = header.map((_, i) => Math.max(...[header, ...body].map(cells => (cells[i] ?? '').length)));
        const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');
        return [`bench: ${this.suite}  (results appended to ${this.file})`, line(header), ...body.map(cells => line(cells))].join('\n');
    }
}

function show(value: number, unit: Unit = 'ms'): string {
    if (unit === 'MiB') return `${value.toFixed(1)}MiB`;
    if (unit === 'count') return value.toFixed(0);
    return value >= 10_000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`;
}
