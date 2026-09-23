/**
 * Timing, summarising and recording for the end-to-end benchmarks.
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
    readonly medianMs: number;
    readonly minMs: number;
    readonly maxMs: number;
    /** $\frac{\max - \min}{\text{median}}$: how far one run can be from another. */
    readonly spread: number;
}

export function summarize(samplesMs: readonly number[]): Summary {
    const sorted = [...samplesMs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 === 1
        ? sorted[mid] as number
        : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
    const minMs = sorted[0] as number;
    const maxMs = sorted[sorted.length - 1] as number;
    return { medianMs, minMs, maxMs, spread: medianMs > 0 ? (maxMs - minMs) / medianMs : 0 };
}

/** Wall time of `run`, in milliseconds, with what it returned. */
export async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
    const start = performance.now();
    const value = await run();
    return { ms: performance.now() - start, value };
}

export interface Metric {
    /** The document or workspace shape, e.g. "large-1mb". */
    readonly subject: string;
    /** What was timed, e.g. "cold check". */
    readonly metric: string;
    readonly samplesMs: readonly number[];
    /** The median past which something is broken rather than slow. */
    readonly ceilingMs: number;
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
        const summary = summarize(metric.samplesMs);
        this.rows.push({ ...metric, ...summary });
        fs.appendFileSync(this.file, `${JSON.stringify({
            at: new Date().toISOString(),
            commit: process.env.BENCH_COMMIT ?? '',
            host: { cpu: os.cpus()[0]?.model ?? '', cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30) },
            suite: this.suite,
            ...metric,
            ...summary,
        })}\n`);
        return summary;
    }

    /** Fail a metric whose median passed its ceiling, unless BENCH_GATE=off. */
    gate(): void {
        if (process.env.BENCH_GATE === 'off') return;
        const broken = this.rows.filter(row => row.medianMs > row.ceilingMs);
        if (broken.length > 0) {
            throw new Error(`past the ceiling: ${broken
                .map(row => `${row.subject} ${row.metric} ${row.medianMs.toFixed(0)}ms > ${row.ceilingMs}ms`)
                .join('; ')}`);
        }
    }

    /** The suite's metrics as a table, for the run's output. */
    table(): string {
        const header = ['subject', 'metric', 'n', 'median', 'min', 'max', 'spread', 'ceiling', 'detail'];
        const body = this.rows.map(row => [
            row.subject, row.metric, String(row.samplesMs.length),
            ms(row.medianMs), ms(row.minMs), ms(row.maxMs), `${(row.spread * 100).toFixed(0)}%`,
            ms(row.ceilingMs), row.detail ?? '',
        ]);
        const widths = header.map((_, i) => Math.max(...[header, ...body].map(cells => (cells[i] ?? '').length)));
        const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');
        return [`bench: ${this.suite}  (results appended to ${this.file})`, line(header), ...body.map(line)].join('\n');
    }
}

function ms(value: number): string {
    return value >= 10_000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`;
}
