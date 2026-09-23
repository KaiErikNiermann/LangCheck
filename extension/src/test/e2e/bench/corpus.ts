/**
 * Generated documents and workspaces for the end-to-end benchmarks.
 *
 * Generated rather than committed: megabytes of prose would sit in the diff
 * of every change near them. Deterministic from a seed, so one run compares
 * with the last, and a new seed gives text the core has never seen -- which
 * a cold check needs, since the core caches each prose range by its text.
 *
 * Plain Node, no `vscode`: `.vscode-test.bench.mjs` runs this to lay out the
 * workspaces before any window opens.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type Lang = 'en' | 'de' | 'fr' | 'es';

/** A seeded generator in [0, 1): mulberry32, small and plenty for varying text. */
export function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

type Next = () => number;

const WORDS: Record<Lang, readonly string[]> = {
    en: ['the', 'checker', 'reads', 'every', 'paragraph', 'and', 'reports', 'what', 'it', 'finds', 'in', 'a',
        'document', 'with', 'several', 'long', 'sentences', 'about', 'nothing', 'much', 'while', 'engines',
        'run', 'quietly', 'over', 'plain', 'prose', 'that', 'nobody', 'will', 'ever', 'read', 'again'],
    de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'Satz', 'mit', 'vielen', 'Wörtern',
        'über', 'nichts', 'Besonderes', 'wird', 'heute', 'geprüft', 'weil', 'man', 'es', 'kann'],
    fr: ['le', 'la', 'les', 'et', 'est', 'une', 'phrase', 'avec', 'beaucoup', 'de', 'mots', 'sur', 'rien',
        'qui', 'sera', 'vérifiée', "aujourd'hui", 'parce', 'que', 'nous', 'pouvons', 'très', 'bien'],
    es: ['el', 'la', 'los', 'y', 'es', 'una', 'frase', 'con', 'muchas', 'palabras', 'sobre', 'nada', 'que',
        'será', 'revisada', 'hoy', 'porque', 'podemos', 'hacerlo', 'también', 'aquí', 'mañana'],
};

/** Misspellings every engine reports, so a generated document always has findings. */
const TYPOS = ['teh', 'recieve', 'seperate', 'definately', 'occured', 'wich', 'untill', 'goverment'];

function pick<T>(next: Next, items: readonly T[]): T {
    return items[Math.floor(next() * items.length)] as T;
}

export function sentence(next: Next, lang: Lang, words = 12): string {
    const out: string[] = [];
    for (let i = 0; i < words; i++) {
        out.push(lang === 'en' && next() < 0.06 ? pick(next, TYPOS) : pick(next, WORDS[lang]));
    }
    const text = out.join(' ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function paragraph(next: Next, lang: Lang, sentences = 5): string {
    return Array.from({ length: sentences }, () => sentence(next, lang, 8 + Math.floor(next() * 10))).join(' ');
}

/** Ordinary Markdown: headings, paragraphs, lists, code, links, until `bytes` long. */
export function markdown(seed: number, bytes: number): string {
    const next = rng(seed);
    const parts: string[] = [`# Document ${seed}`];
    let size = 0;
    for (let i = 0; size < bytes; i++) {
        let part: string;
        if (i % 12 === 11) part = `## Section ${i}`;
        else if (i % 7 === 6) part = Array.from({ length: 4 }, () => `- ${sentence(next, 'en', 6)}`).join('\n');
        else if (i % 9 === 8) part = '```ts\nconst answer = compute(input, { strict: true });\n```';
        else part = `${paragraph(next, 'en')} See [the guide](https://example.com/${i}) and \`inline_${i}\`.`;
        parts.push(part);
        size += part.length + 2;
    }
    return `${parts.join('\n\n')}\n`;
}

/** One line of prose and no newline at all, `bytes` long. */
export function longLine(seed: number, bytes: number): string {
    const next = rng(seed);
    const parts: string[] = [];
    let size = 0;
    while (size < bytes) {
        const s = sentence(next, 'en');
        parts.push(s);
        size += s.length + 1;
    }
    return parts.join(' ');
}

/** Markdown a parser has to survive rather than read: every construct left open or nested absurdly deep. */
export function malformedMarkdown(seed: number): string {
    const next = rng(seed);
    const prose = () => paragraph(next, 'en', 2);
    return [
        `# Broken ${seed}`,
        prose(),
        `${'>'.repeat(400)} ${prose()}`,
        Array.from({ length: 200 }, (_, depth) => `${'  '.repeat(depth)}- ${sentence(next, 'en', 5)}`).join('\n'),
        `[[[[[[ ${prose()} ]] (unclosed link (https://example.com/${seed}`,
        '<div><span><p>',
        prose(),
        '| a | b |\n|---|\n| one | two | three | four |',
        `[loop]: #loop\n[${sentence(next, 'en', 3)}][loop]`,
        '```python',
        prose(),
        '~~~',
        prose(),
        '```unterminated',
        prose(),
    ].join('\n\n');
}

/** LaTeX with its braces, environments and math left unbalanced. */
export function malformedLatex(seed: number): string {
    const next = rng(seed);
    const prose = () => paragraph(next, 'en', 2);
    return [
        '\\documentclass{article}',
        '\\begin{document}',
        `\\section{Broken ${seed}`,
        prose(),
        `${'\\textbf{\\emph{'.repeat(250)}${prose()}`,
        Array.from({ length: 200 }, () => `\\begin{itemize}\\item ${sentence(next, 'en', 5)}`).join('\n'),
        `$ ${prose()} \\frac{a}{`,
        `\\verb|${sentence(next, 'en', 4)}`,
        prose(),
        '\\end{enumerate}',
        prose(),
    ].join('\n\n');
}

/** HTML nested deep and closed nowhere. */
export function malformedHtml(seed: number): string {
    const next = rng(seed);
    const prose = () => paragraph(next, 'en', 2);
    return [
        '<!DOCTYPE html><html><body>',
        `${'<div>'.repeat(5_000)}<p>${prose()}`,
        `<p class="unbalanced>${prose()}`,
        `<script>var x = "${sentence(next, 'en', 4)}`,
        `<p>${prose()}`,
        '<!-- a comment that never ends',
        `<p>${prose()}`,
    ].join('\n');
}

/**
 * Paragraphs cycling through four languages, half of them marked with a
 * scope comment and half left for detection to find.
 */
export function mixedLanguages(seed: number, bytes: number): string {
    const next = rng(seed);
    const langs: readonly Lang[] = ['en', 'de', 'fr', 'es'];
    const parts: string[] = [`# Mixed ${seed}`];
    let size = 0;
    for (let i = 0; size < bytes; i++) {
        const lang = langs[i % langs.length] as Lang;
        const marker = i % 2 === 0 ? `<!-- lang: ${lang} -->\n` : '';
        const part = `${marker}${paragraph(next, lang, 4)}`;
        parts.push(part);
        size += part.length + 2;
    }
    return `${parts.join('\n\n')}\n`;
}

/**
 * Prose laced with what trips byte and character arithmetic: control
 * characters, zero-width joiners, combining marks, right-to-left runs,
 * astral-plane emoji.
 */
export function oddCharacters(seed: number, bytes: number): string {
    const next = rng(seed);
    // Escaped, never literal: a raw U+202E in source reorders how the line
    // around it displays, which is the whole of the Trojan Source trick. No
    // NUL: VS Code will not open a file holding one ("seems to be binary"),
    // and the core's own fuzz covers it.
    const oddities = [
        '\u0007', '\u200b', '\u200d', '\u202e', 'e\u0301\u0302\u0303',
        '\u{1f469}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}', '\u{1f3f3}\ufe0f\u200d\u{1f308}',
        '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645', '\u05e9\u05dc\u05d5\u05dd',
        '\t\t', '\ufeff', '\u{1d518}\u{1d52b}\u{1d526}\u{1d520}\u{1d52c}\u{1d521}\u{1d522}',
    ];
    const parts: string[] = [`# Odd ${seed}`];
    let size = 0;
    while (size < bytes) {
        const words = sentence(next, 'en').split(' ');
        const at = Math.floor(next() * words.length);
        words.splice(at, 0, pick(next, oddities));
        const part = words.join(' ');
        parts.push(part);
        size += part.length + 1;
    }
    return `${parts.join('\n')}\n`;
}

/** Harper only, and nothing that reaches the network, so a run measures this machine. */
export const BENCH_CONFIG = 'engines:\n  harper: true\n  languagetool: false\n';

export interface WorkspaceShape {
    /** Directories at the top level. */
    readonly dirs: number;
    readonly filesPerDir: number;
    readonly fileBytes: number;
    /**
     * How deep each directory nests, each level with its own config file and
     * its own files. 1 is flat.
     */
    readonly depth: number;
}

/**
 * Lay out a workspace of Markdown files, with the benchmark config at its
 * root. `docs/d0/f0.md` always exists, for a suite to open.
 */
export function generateWorkspace(root: string, shape: WorkspaceShape, seed: number): void {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, '.languagecheck.yaml'), BENCH_CONFIG);
    let fileSeed = seed;
    for (let d = 0; d < shape.dirs; d++) {
        let dir = path.join(root, 'docs', `d${d}`);
        for (let level = 0; level < shape.depth; level++) {
            fs.mkdirSync(dir, { recursive: true });
            // A nested config is ignored by design (one config per workspace),
            // which is exactly why it belongs in a benchmark: nothing should
            // walk them.
            if (level > 0) fs.writeFileSync(path.join(dir, '.languagecheck.yaml'), BENCH_CONFIG);
            for (let f = 0; f < shape.filesPerDir; f++) {
                fs.writeFileSync(path.join(dir, `f${f}.md`), markdown(fileSeed++, shape.fileBytes));
            }
            dir = path.join(dir, `n${level}`);
        }
    }
}
