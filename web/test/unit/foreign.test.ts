// @vitest-environment happy-dom
// Reading a site's own spellchecker out of a real CodeMirror: a Typst-like
// checker on @codemirror/lint, an Overleaf-like one on a mark field of its
// own, as research/foreign-checkers.md measured the live sites.
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { afterEach, expect, test } from 'vitest';
import { createCm6Adapter } from '../../src/editor/cm6Adapter';
import type { Cm6Kit } from '../../src/editor/cm6kit';
import { absorbTheme, ForeignMarks, normalizeLanguage } from '../../src/editor/foreign';
import { OVERLEAF_SPELLING } from '../../src/sites/overleaf';
import { TYPST_SPELLING } from '../../src/sites/typst';

const kit: Cm6Kit = { EditorView, StateEffect, StateField, Decoration, Compartment };

/** Overleaf's: marks with `word.lang`, replaced wholesale when its worker answers. */
const overleafAnswer = StateEffect.define<readonly (readonly [number, number])[]>();
const overleafField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(set, tr) {
        let next = set.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(overleafAnswer)) next = Decoration.set(e.value.map(([from, to]) => Decoration.mark({ class: 'ol-cm-spelling-error', word: { lang: 'en_US' } }).range(from, to)));
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

const views: EditorView[] = [];
afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
});

function editor(doc: string): EditorView {
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [overleafField] }), parent: document.body });
    views.push(view);
    return view;
}

/** Typst's answer: hint diagnostics marked `misspelling`, language in `payload`, beside a compile error. */
function typstAnswer(view: EditorView, words: readonly string[], payload = 'en'): void {
    const text = view.state.doc.toString();
    const diagnostics: Diagnostic[] = words.map((word) => {
        const from = text.indexOf(word);
        return { from, to: from + word.length, severity: 'hint', markClass: 'misspelling', message: `the word "${word}" seems to be misspelled`, payload } as Diagnostic;
    });
    diagnostics.push({ from: 0, to: 1, severity: 'error', message: 'unknown variable' });
    view.dispatch(setDiagnostics(view.state, diagnostics));
}

const at = (view: EditorView, word: string): readonly [number, number] => {
    const from = view.state.doc.toString().indexOf(word);
    return [from, from + word.length];
};

const spans = (marks: ForeignMarks, view: EditorView) => marks.read(view).map((f) => `${f.checker}:${view.state.sliceDoc(f.from, f.to)}`);

/** A tracker fed every update of `view`, as the adapter feeds it. */
function tracked(view: EditorView) {
    const marks = new ForeignMarks([TYPST_SPELLING, OVERLEAF_SPELLING], EditorView);
    let answers = 0;
    marks.onDidAnswer(() => answers++);
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((u) => { marks.update(u); })) });
    return { marks, answers: () => answers };
}

test('reads both kinds of mark, with their language and message, and nothing else in the lint field', () => {
    const view = editor('I recieve teh wrod today.');
    const { marks } = tracked(view);
    typstAnswer(view, ['recieve', 'teh'], 'de-DE');
    view.dispatch({ effects: overleafAnswer.of([at(view, 'teh'), at(view, 'wrod')]) });
    expect(marks.read(view)).toEqual([
        { checker: 'typst', rule: 'misspelling', category: 'spelling', from: 2, to: 9, message: 'the word "recieve" seems to be misspelled', language: 'de-DE' },
        { checker: 'overleaf', rule: 'spelling', category: 'spelling', from: 10, to: 13, message: '', language: 'en-US' },
        { checker: 'typst', rule: 'misspelling', category: 'spelling', from: 10, to: 13, message: 'the word "teh" seems to be misspelled', language: 'de-DE' },
        { checker: 'overleaf', rule: 'spelling', category: 'spelling', from: 14, to: 18, message: '', language: 'en-US' },
    ]);
});

test('a mark an edit touched is not read until its checker answers again; one elsewhere follows the edit', () => {
    const view = editor('One teh two wrod three.');
    const { marks, answers } = tracked(view);
    typstAnswer(view, ['teh', 'wrod']);
    expect(answers()).toBe(1);
    // Typst keeps its mark on a corrected word until it answers (measured live).
    const [from, to] = at(view, 'teh');
    view.dispatch({ changes: { from, to, insert: 'the' } });
    view.dispatch({ changes: { from: 0, insert: 'So ' } });
    expect(spans(marks, view)).toEqual(['typst:wrod']);
    // Typing at the end of a word touches it too.
    view.dispatch({ changes: { from: at(view, 'wrod')[1], insert: 'd' } });
    expect(spans(marks, view)).toEqual([]);
    typstAnswer(view, ['wrodd']);
    expect(answers()).toBe(2);
    expect(spans(marks, view)).toEqual(['typst:wrodd']);
});

test('an answer is a change to the marks without an edit; a selection or another field changing is not one', () => {
    const view = editor('teh and wrod');
    const { answers } = tracked(view);
    view.dispatch({ selection: { anchor: 3 } });
    view.dispatch({ effects: overleafAnswer.of([]) });
    expect(answers()).toBe(0);
    view.dispatch({ effects: overleafAnswer.of([at(view, 'teh')]) });
    expect(answers()).toBe(1);
    view.dispatch({ selection: { anchor: 5 } });
    expect(answers()).toBe(1);
    // All fixed: the set empties, which is an answer too.
    view.dispatch({ effects: overleafAnswer.of([]) });
    expect(answers()).toBe(2);
});

test('through the adapter: findings read in current offsets, and the site checker hidden by naming it on the editor', () => {
    const view = editor('I recieve teh parcel.');
    const cm6 = createCm6Adapter(view, kit, 'typst:/p/doc', 'typst', [TYPST_SPELLING]);
    view.dispatch({ effects: StateEffect.appendConfig.of(cm6.extension) });
    let told = 0;
    cm6.adapter.onDidChangeForeign?.(() => told++);
    typstAnswer(view, ['teh']);
    expect(told).toBe(1);
    expect(cm6.adapter.foreignFindings?.().map((f) => [f.from, f.to])).toEqual([[10, 13]]);
    expect(view.dom.dataset.lcAbsorb).toBeUndefined();
    cm6.adapter.setForeignHidden?.(true);
    expect(view.dom.dataset.lcAbsorb).toBe('typst');
    cm6.adapter.setForeignHidden?.(false);
    expect(view.dom.dataset.lcAbsorb).toBeUndefined();
    cm6.adapter.setForeignHidden?.(true);
    cm6.dispose();
    expect(view.dom.dataset.lcAbsorb).toBeUndefined();
    expect(cm6.adapter.foreignFindings?.()).toEqual([]);
});

test('the hiding rules apply only while the editor names the checker', () => {
    expect(Object.keys(absorbTheme([OVERLEAF_SPELLING]))).toEqual(['&[data-lc-absorb~="overleaf"] .ol-cm-spelling-error']);
    const typst = Object.keys(absorbTheme([TYPST_SPELLING]));
    for (const selector of typst) expect(selector.startsWith('&[data-lc-absorb~="typst"] ')).toBe(true);
});

test('languages come out as BCP 47, or empty when a checker wrote something else', () => {
    expect(['en_US', 'de-DE', 'en', ' fr ', 'zh_Hant_TW'].map((v) => normalizeLanguage(v))).toEqual(['en-US', 'de-DE', 'en', 'fr', 'zh-Hant-TW']);
    expect(['', 'english', 'e', 'en--US', 'en-toolongsubtag', 42, undefined].map((v) => normalizeLanguage(v))).toEqual(['', '', '', '', '', '', '']);
});
