// The card tells actions apart by kind; the extension's commands decide it.
import { expect, test } from 'vitest';
import { COMMANDS } from '../../../extension/src/commands/ids';
import { actionKind } from '../../src/editor/actionKind';

const shape = (over: Partial<Parameters<typeof actionKind>[0]>): Parameters<typeof actionKind>[0] => ({ preferred: false, edits: false, command: undefined, ...over });

test('the top suggestion is preferred, other edits are fixes', () => {
    expect(actionKind(shape({ preferred: true, edits: true }))).toBe('preferred');
    expect(actionKind(shape({ edits: true }))).toBe('fix');
});

test("each of the card's commands has its kind; an unknown one is other", () => {
    expect(actionKind(shape({ command: COMMANDS.addToDictionary }))).toBe('dictionary');
    expect(actionKind(shape({ command: COMMANDS.ignoreDiagnostic }))).toBe('ignore');
    expect(actionKind(shape({ command: COMMANDS.ignoreSelection }))).toBe('ignore');
    expect(actionKind(shape({ command: COMMANDS.fixAllSpellingInFile }))).toBe('fix-all');
    expect(actionKind(shape({ command: COMMANDS.fixAllSpellingInWorkspace }))).toBe('fix-all');
    expect(actionKind(shape({ command: 'somebody.else' }))).toBe('other');
});
