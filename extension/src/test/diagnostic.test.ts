import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import {
    addSuggestionEdit,
    diagId,
    ignoreRequest,
    insertedText,
    isSpellingOf,
    isSpellingRule,
    parseDiagId,
    ruleIdOf,
    type DiagId,
    type ExtendedDiagnostic,
} from '../diagnostics/diagnostic';
import { coreByte } from '../checking/offsets';
import { Position, Range, Uri, WorkspaceEdit } from './__mocks__/vscode';

const range = new Range(new Position(0, 4), new Position(0, 11));

function diagnostic(code: string | undefined, extra: Partial<ExtendedDiagnostic> = {}): ExtendedDiagnostic {
    return { range, message: 'm', severity: 1, code, ...extra } as unknown as ExtendedDiagnostic;
}

/** A document whose text at any range is `word`. */
function documentReading(word: string): vscode.TextDocument {
    return { getText: () => word } as unknown as vscode.TextDocument;
}

describe('ruleIdOf', () => {
    it('returns the code', () => {
        expect(ruleIdOf(diagnostic('harper.Spelling'), '')).toBe('harper.Spelling');
    });

    it('returns each caller\'s own fallback when there is none', () => {
        expect(ruleIdOf(diagnostic(undefined), '')).toBe('');
        expect(ruleIdOf(diagnostic(undefined), 'unknown')).toBe('unknown');
        expect(ruleIdOf(diagnostic(undefined), undefined)).toBeUndefined();
    });
});

describe('isSpellingRule', () => {
    it.each(['harper.Spelling', 'hunspell.spelling', 'languagetool.MORFOLOGIK_RULE_EN_US'])('accepts %s', id => {
        expect(isSpellingRule(id)).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isSpellingRule('harper.Capitalization')).toBe(false);
        expect(isSpellingRule('')).toBe(false);
    });
});

describe('isSpellingOf', () => {
    it('matches a spelling finding on exactly the word', () => {
        expect(isSpellingOf(documentReading('recieve'), diagnostic('harper.Spelling'), 'recieve')).toBe(true);
    });

    it('is case-sensitive', () => {
        expect(isSpellingOf(documentReading('Recieve'), diagnostic('harper.Spelling'), 'recieve')).toBe(false);
    });

    it('ignores findings that are not spelling', () => {
        expect(isSpellingOf(documentReading('recieve'), diagnostic('harper.Capitalization'), 'recieve')).toBe(false);
    });
});

describe('diag ids', () => {
    it('round-trip, generation and index', () => {
        expect(diagId(3, 7)).toBe('diag-3-7');
        expect(parseDiagId(diagId(3, 7))).toEqual({ generation: 3, index: 7 });
    });

    it.each(['nonsense', 'diag-7', 'diag--1-2', 'diag-1-2-3', 'diag-1-2x', ' diag-1-2', 'diag-1-1e3', `diag-1-${'9'.repeat(16)}`])(
        'parse %j as nothing',
        (id) => {
            // The type rules these out, but a webview message is JSON and
            // could still carry anything.
            expect(parseDiagId(id as DiagId)).toBeUndefined();
        },
    );
});

describe('insertedText', () => {
    it.each([
        ['Insert ","', ','],
        ['Insert “the”', 'the'],
    ])('reads %s', (suggestion, expected) => {
        expect(insertedText(suggestion)).toBe(expected);
    });

    it('is null for a plain replacement', () => {
        expect(insertedText('receive')).toBeNull();
        expect(insertedText('')).toBeNull();
    });
});

describe('addSuggestionEdit', () => {
    const uri = Uri.file('/doc.md');

    it('inserts an Insert suggestion at the end of the range', () => {
        const edit = new WorkspaceEdit();
        addSuggestionEdit(edit as unknown as vscode.WorkspaceEdit, uri as unknown as vscode.Uri, range as unknown as vscode.Range, 'Insert ","');
        expect(edit.ops).toEqual([{ kind: 'insert', uri, at: range.end, text: ',' }]);
    });

    it('replaces the range otherwise, and an empty suggestion deletes it', () => {
        const edit = new WorkspaceEdit();
        addSuggestionEdit(edit as unknown as vscode.WorkspaceEdit, uri as unknown as vscode.Uri, range as unknown as vscode.Range, 'receive');
        addSuggestionEdit(edit as unknown as vscode.WorkspaceEdit, uri as unknown as vscode.Uri, range as unknown as vscode.Range, '');
        expect(edit.ops).toEqual([
            { kind: 'replace', uri, at: range, text: 'receive' },
            { kind: 'replace', uri, at: range, text: '' },
        ]);
    });
});

describe('ignoreRequest', () => {
    it('carries the full text and the core offsets', () => {
        const d = diagnostic('harper.Spelling', { coreStartByte: coreByte(4), coreEndByte: coreByte(11) });
        expect(ignoreRequest(d, documentReading('recieve'), 'We recieve it.')).toEqual({
            ignore: { message: 'm', context: 'recieve', text: 'We recieve it.', startByte: 4, endByte: 11 },
        });
    });

    it('sends zero offsets when the core gave none', () => {
        expect(ignoreRequest(diagnostic(undefined), documentReading('x'), 'x').ignore).toMatchObject({ startByte: 0, endByte: 0 });
    });
});
