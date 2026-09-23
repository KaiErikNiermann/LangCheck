/**
 * `src/generated/meta.ts` is committed, so it can drift from package.json. The
 * same check the Rust side makes for its checked-in schema: regenerate, and
 * fail when the result differs from what is in the tree.
 */
import * as fs from 'fs';
import * as path from 'path';
import { generate } from 'vscode-ext-gen';
import { expect, it } from 'vitest';

it('src/generated/meta.ts is what `pnpm run gen:meta` produces from package.json', async () => {
    const root = path.resolve(__dirname, '../..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const { dts } = await generate(manifest, { cwd: root });
    const committed = fs.readFileSync(path.join(root, 'src/generated/meta.ts'), 'utf8');
    expect(committed, 'stale: run `pnpm run gen:meta`').toBe(dts);
});
