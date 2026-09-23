import { describe, expect, it } from 'vitest';

import { otherCopies } from '../shared/otherCopies';

const ours = { id: 'KaiErikNiermann.language-check', extensionPath: '/ext/lc', packageJSON: { version: '0.6.2', contributes: { commands: [{ command: 'language-check.checkDocument' }] } } };

describe('otherCopies', () => {
    it('finds a copy under another id by the commands it contributes', () => {
        const fork = { id: 'someone.language-check-fork', extensionPath: '/ext/fork', packageJSON: { version: '0.5.0', contributes: { commands: [{ command: 'language-check.checkDocument' }] } } };
        expect(otherCopies([ours, fork], ours.id)).toEqual([{ id: fork.id, version: '0.5.0', path: '/ext/fork' }]);
    });

    it('does not count this extension, however its id is cased, or unrelated ones', () => {
        const unrelated = { id: 'redhat.vscode-yaml', extensionPath: '/ext/yaml', packageJSON: { contributes: { commands: [{ command: 'yaml.x' }] } } };
        const oddShapes = { id: 'x.y', extensionPath: '/ext/y', packageJSON: { contributes: { commands: 'not a list' } } };
        expect(otherCopies([ours, unrelated, oddShapes, { id: 'x.z', extensionPath: '/z', packageJSON: null }], ours.id.toLowerCase())).toEqual([]);
    });
});
