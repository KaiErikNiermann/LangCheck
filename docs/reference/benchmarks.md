# Benchmarks and memory tests

LangCheck has three sets of performance checks besides its unit and end-to-end tests: the core's own (Rust), the VS Code extension's end-to-end benchmarks, and the browser extension's benchmarks, memory bounds and soak. None of them run in CI: timings depend on the machine and on what else it is doing. They are a record of what each case costs, and a ceiling far above a normal run that only something broken (a quadratic step, a cache that never hits, a hang) reaches.

The two editor harnesses share their generated documents and their recorder: `extension/src/test/e2e/bench/corpus.ts` (seeded generators, so each run checks text the core has never seen) and `extension/src/test/e2e/bench/measure.ts` (median, spread, ceilings, one JSON line per metric).

## Running them

| What | Command | Results |
| --- | --- | --- |
| VS Code: documents and workspaces | `cd extension && pnpm run bench:e2e` | `extension/.vscode-test/bench/results.jsonl` |
| Browser: documents on Overleaf and Typst | `cd web && pnpm run bench documents` | `web/.bench/results.jsonl` |
| Browser: memory at the edges | `cd web && pnpm run bench memory` | `web/.bench/results.jsonl` |
| Browser: soak | `cd web && SOAK_MINUTES=60 pnpm run bench soak` | `web/.bench/results.jsonl`, `web/.bench/soak-<time>.jsonl` |
| Browser e2e scale and memory fixtures | `cd web && pnpm exec playwright test realPathScale realPathMemory` | `web/.bench/scale.jsonl` |
| Core: malformed input | `MALFORMED_FUZZ_ITERATIONS=5000 cargo test --release --test malformed_input_fuzz` | the test's output |
| Core: server memory over 100 000 checks | `cargo test --release --test server_protocol checking_for_long_does_not_grow_the_server -- --ignored` | the test's output |

`BENCH_REPS=N` sets the repetitions per metric (default 5, after one discarded warm-up) and `BENCH_GATE=off` records without failing on a ceiling. Wrap long runs in a memory guard (`pm run --max-mem 16G -- …`): the large cases hold a lot of text in several processes at once.

The browser benchmarks drive the whole path in Chromium: the page script, the content script, the background, the native host and the release core, on the stand-in Overleaf and Typst pages of the end-to-end tests. Each test gets its own browser, native host and core server. They run one test at a time, so the timings and process memory are this machine's, with nothing else of LangCheck's running.

Each result line carries the commit, the machine, the suite, the subject and metric, every sample, and `median`, `min`, `max`, `spread` and `unit` (`ms`, `MiB` or `count`). Lines written before 2026-10-14 name these `medianMs`, `samplesMs` and so on.

## What the browser benchmarks measure

For each document, generated afresh for every repetition:

| Metric | What it is |
| --- | --- |
| open + cold check | From opening text the core has never seen to the last change in the page's findings. |
| first answer | To the first check that finished: for a progressive check, its first window. |
| reopen (cached) | The same text opened as another file: what the core answers from its caches. |
| type to findings | A sentence typed at the end, to its findings. Includes the 500 ms typing pause. |
| main thread held (TBT) | Total blocking time of the page while the findings were drawn: time past 50 ms in each long task. |
| page heap, background heap | JS heaps after forced collections (the DevTools protocol). |
| native host RSS, core server RSS | Resident memory of the two processes this test's browser started. |

Opening a file costs 250 ms on average before any check starts: the sites announce no file switch, so the page looks for one every 500 ms (`POLL_MS` in `web/src/page/bridge.ts`). That is why a cached reopen of a small file takes about 400 ms on the web against a few in VS Code.

## Results, 2026-10-14

Ryzen 9 9900X3D, 24 threads, release core, Chromium 147, Harper only (`BENCH_CONFIG`). Medians of three, every ceiling met.

| Document | Open + cold check | Reopen (cached) | Type to findings | Main thread held | Page heap | Core server RSS |
| --- | --- | --- | --- | --- | --- | --- |
| LaTeX 4 KB | 456 ms | 360 ms | 520 ms | 0 ms | 6.6 MiB | 174 MiB |
| LaTeX 256 KB | 3.6 s | 306 ms | 747 ms | 0 ms | 10.3 MiB | 377 MiB |
| LaTeX 1 MB (12 848 findings) | 12.9 s | 541 ms | 1.4 s | 21 ms | 20.2 MiB | 461 MiB |
| Typst 4 KB | 502 ms | 360 ms | 513 ms | 0 ms | 6.6 MiB | 175 MiB |
| Typst 256 KB | 3.4 s | 530 ms | 629 ms | 0 ms | 10.4 MiB | 316 MiB |
| Typst 1 MB (12 914 findings) | 12.3 s | 329 ms | 958 ms | 26 ms | 20.6 MiB | 552 MiB |
| One 256 KB line | 3.8 s | 212 ms | 767 ms | 0 ms | 10.2 MiB | 376 MiB |
| Misspellings only, 64 KB (10 309 findings) | 1.0 s | 438 ms | 653 ms | 7 ms | 15.6 MiB | 212 MiB |
| Malformed LaTeX | 570 ms | 290 ms | 522 ms | 0 ms | 6.6 MiB | 229 MiB |
| Mixed languages, 64 KB | 978 ms | 469 ms | 564 ms | 0 ms | 9.3 MiB | 308 MiB |
| Odd characters, 64 KB | 1.3 s | 118 ms | 542 ms | 0 ms | 7.7 MiB | 330 MiB |

A cold check is linear in the text: Harper at about 13 s a megabyte, as in VS Code (11.8 s for 1 MB of Markdown). The background holds 3 MiB throughout and the native host at most 24 MiB. The page's main thread is never held for long: the longest task with 1 MB open was under 80 ms.

A progressive check of 1 MB of LaTeX in 16 KiB windows shows its first window after 1.4 s and its last after 17.4 s.

What costs a cached check of a long document is the parse: the core reads the whole text again each time it is sent, 685 ms a megabyte for LaTeX and 252 ms for Typst. The LaTeX figure is the grammar's own (tree-sitter-latex, upstream HEAD as fast as the release used). An edit pays it once. Reopening the same text, or each window of a progressive check, does not: the core keeps its last extraction.

### Found and fixed by these runs

- Every check of a Typst document longer than about 400 KB re-linted all of it: 4.8 s for a cached check of 1 MB against 0.33 s now. The result cache held 4096 prose ranges, and a 1 MB Typst file is 10 026 of them, so each check evicted every answer before the next asked for it. The cache now holds 131 072 answers and at most 64 MiB (`performance.result_cache_entries`).
- A progressive check parsed the whole document once per window: 61 s for 1 MB, now 17.4 s.
- One lone surrogate (half of an emoji) anywhere in a page's text cost the whole document its check: the core's UTF-8 protocol cannot carry it, and the request was refused. The page now sends U+FFFD in its place, which keeps every offset.
- A backslash before a multi-byte character in LaTeX or Forester (`\` then U+FEFF, an accented letter, or that U+FFFD) panicked the extraction, and the document went unchecked. Every gap token now ends on a character boundary.

## Memory at the edges

`memory.bench.ts` opens one hostile document per test, then goes back to a small file. Peaks are each process's high-water mark (`VmHWM`) for that one document.

| Document | Cold check | Core server peak | Native host peak | Page heap holding it | Page heap kept after |
| --- | --- | --- | --- | --- | --- |
| LaTeX at the size cap (2 M characters, 25 590 findings) | 25.0 s | 330 MiB | 27 MiB | 36 MiB | 0.6 MiB |
| Misspellings only, 512 KB (82 683 findings) | 4.7 s | 260 MiB | 66 MiB | 75 MiB | 0.7 MiB |
| One 1 MB line | 13.3 s | 298 MiB | 17 MiB | 20 MiB | 0.6 MiB |
| A million blank lines | 799 ms | 165 MiB | 10 MiB | 19 MiB | 0.5 MiB |
| 100 000 unclosed `\textbf{` | 649 ms | 210 MiB | 9 MiB | 8 MiB | 0.5 MiB |
| Odd characters, 1 MB | 13.8 s | 298 MiB | 18 MiB | 22 MiB | 0.6 MiB |
| Lone surrogates, NULs, lone CRs and BOMs, 256 KB (5822 findings) | 3.8 s | 284 MiB | 11 MiB | 13 MiB | 0.6 MiB |

The background kept under 0.1 MiB after each. CodeMirror draws only what is near the view, so the page's DOM stayed under 4 400 nodes even with 82 683 findings. A document past the cap is not sent at all: the page says so once, and neither process grows. No process died and was restarted in any case.

## Soak

`soak.bench.ts` keeps one page in use: typing a sentence with a mistake and taking it out again, switching between five files (one switch in five to a file never opened before), hovering a finding, opening and closing the palette, taking in a collaborator's edit, and opening and closing SpeedFix every two minutes. The document returns to the same text after each step, so whatever grows grows with time alone. Every 30 s it samples the page's heap, DOM nodes and event listeners, the background's heap, and the native host's and core server's RSS, open files and threads. The growth per hour after the first quarter of the run (a least-squares slope) is gated.

A 20-minute soak on 2026-10-14 (838 steps, 1047 checks, 40 samples):

| Series | Growth per hour after warm-up | Ceiling |
| --- | --- | --- |
| Page heap | 1.4 MiB | 8 MiB |
| Background heap | −0.1 MiB | 4 MiB |
| Native host RSS | 0.3 MiB | 8 MiB |
| Core server RSS | 47 MiB | 64 MiB |
| DOM nodes | −179 | 500 |
| Event listeners | 0 | 50 |
| Native host and server open files, server threads | 0 | 1–2 |

The page went from 6.0 to 9.7 MiB, most of it in the first minute, the background stayed at 3 MiB and the native host at 7.6 MiB. The core server climbs for longer: its caches (engine answers, Harper's own) fill with every new text, up to their bounds. Twenty minutes does not reach them; `checking_for_long_does_not_grow_the_server` (above) runs a server through 100 000 checks of different text and gates on the last 25 000: 441 MiB after 75 000 checks, 446 MiB after 100 000 (debug build, 2026-10-14).

## Against the sites' own spellcheckers

Measured live on overleaf.com in Firefox 155 on 2026-10-14 with `web/test/bench/live/load.js`: from the page's navigation start to each checker's first marks, for the document the page opened with.

| Document | LangCheck | Overleaf's checker |
| --- | --- | --- |
| LaTeX 4 KB | 1.7–6.4 s, 45–67 findings | 2.3–8.5 s, 33–44 marks |
| LaTeX 256 KB | 7.3 s, 3341 findings | 11.7 s, 50 marks |
| LaTeX 1 MB | 7.5 s, 12 802 findings | 10.6 s, 41 marks |

The 4 KB ranges are two loads of the same project: the spread is between the loads, and in each LangCheck was first, by 0.6 s and 2.1 s. LangCheck's figures for 256 KB and 1 MB are answers from the core's cache: the text had been checked when it was put in the editor, before the reload (a cold check of 1 MB takes 13 s, above). Overleaf's checker covers only what has been in view: it checks lines as they scroll into view and keeps what it found, so its count on load is the first screen's (50 marks up to offset 4725 of the 256 KB document; 85 after scrolling to its end). LangCheck checks the whole document.

Typst's own checker could not be compared: it marked nothing in the project used, with or without compile errors, so its spellcheck was most likely switched off there.
