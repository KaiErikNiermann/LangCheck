// @vitest-environment happy-dom
// A site's documents as workspace files: the paths each site reads from its
// own page and API, which the config's include and exclude then match.
import { describe, expect, test, vi } from 'vitest';
import { excludeDocument, CONFIG_NOT_EDITABLE, perWorkspace } from '../../src/background/excludeDocument';
import type { ConfigRequest } from '../../src/messaging/config';
import type { PageResponse } from '../../src/messaging/protocol';
import { breadcrumbTitles, notionPagePath } from '../../src/sites/notion';
import { entityPathsIn, trailInTree } from '../../src/sites/overleaf';
import { fileListCache, pathFromTrail, pathSegment, RELIST_MS } from '../../src/sites/site';
import { headerTrail, projectFilesIn } from '../../src/sites/typst';

describe('pathSegment', () => {
    test.each([
        ['Logical Verification', 'Logical Verification'],
        ['A/B tests', 'A-B tests'],
        ['  padded  ', 'padded'],
        ['', 'Untitled'],
        ['..', 'Untitled'],
        ['tab\there', 'tab-here'],
        ['Week 1: Logic', 'Week 1: Logic'],
        // Windows would read it as a drive.
        ['C: notes', 'C- notes'],
    ])('%j is the segment %j', (title, segment) => {
        expect(pathSegment(title)).toBe(segment);
    });
});

describe('pathFromTrail', () => {
    const known = new Set(['main.typ', 'chapters/intro.typ']);
    test('the longest run of trailing names the project has', () => {
        expect(pathFromTrail(['Kai', 'test', 'chapters', 'intro.typ'], known, 'x')).toBe('chapters/intro.typ');
        expect(pathFromTrail(['Kai', 'test', 'main.typ'], known, 'x')).toBe('main.typ');
    });
    test('the fallback when the project is not read yet or lacks the name', () => {
        expect(pathFromTrail(['Kai', 'test', 'new.typ'], known, 'new.typ')).toBe('new.typ');
        expect(pathFromTrail(['a.typ'], undefined, undefined)).toBeUndefined();
    });
});

describe('fileListCache', () => {
    test('a path the list lacks has it read again, no sooner than RELIST_MS after the last read', async () => {
        let clock = 0;
        const lists = [['main.tex'], ['main.tex', 'chapters/intro.tex']];
        const read = vi.fn(() => Promise.resolve(lists.shift()));
        const cache = fileListCache(read, () => clock);
        const settled = () => new Promise((resolve) => { setTimeout(resolve, 0); });
        // None read yet: the fallback, and a read starts.
        expect(cache.resolve(['chapters', 'intro.tex'], 'chapters/intro.tex')).toBe('chapters/intro.tex');
        await settled();
        expect(read).toHaveBeenCalledTimes(1);
        // The file was made after that read: too soon to read again.
        cache.resolve(['chapters', 'intro.tex'], 'chapters/intro.tex');
        expect(read).toHaveBeenCalledTimes(1);
        clock += RELIST_MS;
        cache.resolve(['chapters', 'intro.tex'], 'chapters/intro.tex');
        expect(read).toHaveBeenCalledTimes(2);
        await settled();
        // Now the list has it: found from the whole trail, and nothing more is read.
        clock += RELIST_MS;
        expect(cache.resolve(['Kai', 'test', 'chapters', 'intro.tex'], undefined)).toBe('chapters/intro.tex');
        expect(read).toHaveBeenCalledTimes(2);
    });
});

describe('Overleaf', () => {
    test("the entities list, without its leading slashes and entries that are not paths", () => {
        expect(entityPathsIn({ entities: [{ path: '/main.tex', type: 'doc' }, { path: '/figures/a.png', type: 'file' }, { path: 'no-slash' }, { type: 'doc' }] })).toEqual(['main.tex', 'figures/a.png']);
        expect(entityPathsIn({ nope: true })).toBeUndefined();
    });

    test('the tree trail of the open document, folders first', () => {
        document.body.innerHTML = `
            <ul role="tree">
              <li role="treeitem" aria-label="chapters" aria-expanded="true">
                <ul role="group">
                  <li role="treeitem" aria-label="drafts" aria-expanded="true">
                    <ul role="group"><li role="treeitem" aria-label="old.tex" aria-selected="true"></li></ul>
                  </li>
                </ul>
              </li>
              <li role="treeitem" aria-label="main.tex" aria-selected="false"></li>
            </ul>`;
        expect(trailInTree(document, 'old.tex')).toEqual(['chapters', 'drafts', 'old.tex']);
        // An image selected while the editor shows another document: no trail.
        expect(trailInTree(document, 'main.tex')).toBeUndefined();
    });

    test("Overleaf's own tree, where a folder's contents follow its item", () => {
        // As overleaf.com drew it on 2026-10-14.
        document.body.innerHTML = `
            <ul role="tree" data-testid="file-tree-list-root"><div>
              <li role="treeitem" aria-selected="false" aria-expanded="true" aria-label="chapters"></li>
              <ul role="tree"><div>
                <li role="treeitem" aria-selected="false" aria-expanded="true" aria-label="drafts"></li>
                <ul role="tree"><div><li role="treeitem" aria-selected="true" aria-label="old.tex"></li></div></ul>
              </div></ul>
              <li role="treeitem" aria-selected="false" aria-label="main.tex"></li>
            </div></ul>`;
        expect(trailInTree(document, 'old.tex')).toEqual(['chapters', 'drafts', 'old.tex']);
    });
});

describe('Typst', () => {
    test("a file's name is its path", () => {
        expect(projectFilesIn({ data: { project: { files: [{ name: 'chapters/intro.typ' }, { name: 'main.typ' }, { id: 'x' }] } } })).toEqual(['chapters/intro.typ', 'main.typ']);
        expect(projectFilesIn({ errors: [{}] })).toBeUndefined();
    });

    test('the header names owner, project, folders and file', () => {
        document.body.innerHTML = '<header><div role="heading"><span><span> Kai</span></span><span><span> test</span></span><span><span> chapters</span></span><span><span> intro.typ</span></span></div></header>';
        expect(headerTrail(document)).toEqual(['Kai', 'test', 'chapters', 'intro.typ']);
    });
});

describe('Notion', () => {
    test('a page is the file its breadcrumb names', () => {
        document.body.innerHTML = `
            <div class="notion-topbar"><div class="shadow-cursor-breadcrumb">
              <a href="/p/x">University Courses</a><span aria-hidden="true">/</span><span><div role="button">Logical Verification</div></span>
              <div data-popup-origin="true"><div role="button"><span>Private</span></div></div>
            </div></div>
            <div class="notion-frame"></div>`;
        const frame = document.querySelector('.notion-frame');
        if (frame === null) throw new Error('no frame');
        expect(breadcrumbTitles(frame)).toEqual(['University Courses', 'Logical Verification']);
        expect(notionPagePath(breadcrumbTitles(frame))).toBe('University Courses/Logical Verification.md');
        expect(notionPagePath(['A/B tests'])).toBe('A-B tests.md');
        // A peek has no breadcrumb: it sits under the page it opened over.
        const peek = document.createElement('div');
        peek.className = 'notion-peek-renderer';
        peek.innerHTML = '<div class="notion-page-block"><h1 aria-roledescription="page title">Week 1</h1></div>';
        document.body.append(peek);
        expect(breadcrumbTitles(peek)).toEqual(['University Courses', 'Logical Verification', 'Week 1']);
        expect(notionPagePath([])).toBeUndefined();
    });
});

describe('excludeDocument', () => {
    const ok = (response: Record<string, unknown>): PageResponse => ({ id: 1, ok: true, response });
    function ask(config: string, writable = true) {
        const asked: ConfigRequest[] = [];
        const fn = vi.fn((request: ConfigRequest): Promise<PageResponse> => {
            asked.push(request);
            if ('readConfig' in request) return Promise.resolve(ok({ readConfig: { text: config } }));
            return Promise.resolve(writable ? ok({ ok: {} }) : { id: 1, ok: false, code: 'refused', error: 'refused' });
        });
        return { fn, asked };
    }

    test('adds the path, escaped to match only itself, and reloads', async () => {
        const { fn, asked } = ask('exclude:\n  - "Journal/**"\n');
        const changed = vi.fn(() => Promise.resolve());
        await expect(excludeDocument(9, 'Notes/[draft] *.md', fn, changed)).resolves.toEqual({ id: 9, ok: true, response: { excluded: { pattern: 'Notes/[[]draft[]] [*].md', already: false } } });
        expect(asked.at(-1)).toEqual({ writeConfig: { text: 'exclude:\n  - "Journal/**"\n  - Notes/[[]draft[]] [*].md\n' } });
        expect(changed).toHaveBeenCalledOnce();
    });

    test('a path already excluded is said so, with nothing written', async () => {
        const { fn, asked } = ask('exclude: [main.tex]\n');
        const changed = vi.fn(() => Promise.resolve());
        await expect(excludeDocument(2, 'main.tex', fn, changed)).resolves.toMatchObject({ ok: true, response: { excluded: { already: true } } });
        expect(asked).toEqual([{ readConfig: {} }]);
        expect(changed).not.toHaveBeenCalled();
    });

    test('a config that does not parse is left alone', async () => {
        const { fn, asked } = ask('exclude: [unclosed\n');
        await expect(excludeDocument(3, 'a.md', fn, () => Promise.resolve())).resolves.toEqual({ id: 3, ok: false, code: 'failed', error: CONFIG_NOT_EDITABLE });
        expect(asked).toEqual([{ readConfig: {} }]);
    });

    test('two at once on one workspace both land: each reads what the other wrote', async () => {
        let config = 'exclude: []\n';
        const store = (request: ConfigRequest): Promise<PageResponse> => {
            if ('readConfig' in request) return Promise.resolve(ok({ readConfig: { text: config } }));
            // A write lands a moment later, as the native host's does.
            return new Promise((resolve) => setTimeout(() => {
                if ('writeConfig' in request) config = request.writeConfig.text;
                resolve(ok({ ok: {} }));
            }, 5));
        };
        const inTurn = perWorkspace();
        await Promise.all(['a.tex', 'b.tex'].map((path, i) => inTurn('overleaf-p1', () => excludeDocument(i + 1, path, store, () => Promise.resolve()))));
        expect(config).toContain('a.tex');
        expect(config).toContain('b.tex');
    });

    test('a refused write reloads nothing', async () => {
        const { fn } = ask('', false);
        const changed = vi.fn(() => Promise.resolve());
        await expect(excludeDocument(4, 'a.md', fn, changed)).resolves.toMatchObject({ id: 4, ok: false });
        expect(changed).not.toHaveBeenCalled();
    });
});
