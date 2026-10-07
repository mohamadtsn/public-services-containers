import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  staticAdd,
  staticList,
  staticMount,
  staticRemove,
  staticUnmount,
  staticUpdate,
} from '../src/commands/static.js';
import { type Ctx, context } from '../src/context.js';
import { readState } from '../src/state.js';
import { UserError } from '../src/ui.js';

describe('static sites', () => {
  let dir: string;
  let src: string;
  let ctx: Ctx;
  /** Extra temp dirs created inside a test; removed even when it fails. */
  let extra: string[];

  const sitePath = (name: string) => join(dir, 'nginx', 'static', name);
  const tempDir = (prefix: string): string => {
    const made = mkdtempSync(join(tmpdir(), prefix));
    extra.push(made);
    return made;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-static-'));
    src = mkdtempSync(join(tmpdir(), 'pubservices-src-'));
    mkdirSync(join(src, 'assets'), { recursive: true });
    writeFileSync(join(src, 'index.html'), '<h1>v1</h1>');
    writeFileSync(join(src, 'assets', 'app.js'), 'console.log(1)');
    ctx = context({ home: dir, yes: true });
    extra = [];
  });

  afterEach(() => {
    for (const path of [dir, src, ...extra]) rmSync(path, { recursive: true, force: true });
  });

  it('syncs a build directory and records its source', async () => {
    await staticAdd(ctx, 'myapp', src);

    expect(readFileSync(join(sitePath('myapp'), 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    expect(existsSync(join(sitePath('myapp'), 'assets', 'app.js'))).toBe(true);
    expect(readState(dir).staticSources['myapp']).toBe(src);
  });

  it('re-syncs and removes files deleted from the source', async () => {
    await staticAdd(ctx, 'myapp', src);

    writeFileSync(join(src, 'index.html'), '<h1>v2</h1>');
    rmSync(join(src, 'assets', 'app.js'));
    await staticUpdate(ctx, 'myapp');

    expect(readFileSync(join(sitePath('myapp'), 'index.html'), 'utf8')).toBe('<h1>v2</h1>');
    // Stale files must not survive a re-sync, or the browser keeps loading them.
    expect(existsSync(join(sitePath('myapp'), 'assets', 'app.js'))).toBe(false);
  });

  it('updates every recorded site when no name is given', async () => {
    const other = tempDir('pubservices-src2-');
    writeFileSync(join(other, 'index.html'), 'other');
    await staticAdd(ctx, 'one', src);
    await staticAdd(ctx, 'two', other);

    writeFileSync(join(src, 'index.html'), 'one-updated');
    writeFileSync(join(other, 'index.html'), 'two-updated');
    await staticUpdate(ctx, undefined);

    expect(readFileSync(join(sitePath('one'), 'index.html'), 'utf8')).toBe('one-updated');
    expect(readFileSync(join(sitePath('two'), 'index.html'), 'utf8')).toBe('two-updated');
  });

  it('rejects names that would escape the static directory', async () => {
    await expect(staticAdd(ctx, '../evil', src)).rejects.toThrow(UserError);
    await expect(staticAdd(ctx, 'a/b', src)).rejects.toThrow(UserError);
    await expect(staticAdd(ctx, '.hidden', src)).rejects.toThrow(UserError);
  });

  it('reports a missing source directory instead of syncing nothing', async () => {
    await expect(staticAdd(ctx, 'myapp', join(src, 'nope'))).rejects.toThrow(UserError);
  });

  it('adopts source paths recorded by v1 in .sources/', async () => {
    // v1 kept one file per site; an upgraded install must keep working.
    const legacy = join(dir, 'nginx', 'static', '.sources');
    mkdirSync(legacy, { recursive: true });
    mkdirSync(sitePath('legacyapp'), { recursive: true });
    writeFileSync(join(legacy, 'legacyapp'), `${src}\n`);

    await staticUpdate(ctx, 'legacyapp');

    expect(readFileSync(join(sitePath('legacyapp'), 'index.html'), 'utf8')).toBe('<h1>v1</h1>');
    expect(readState(dir).staticSources['legacyapp']).toBe(src);
  });

  it('removes a site and forgets its source', async () => {
    await staticAdd(ctx, 'myapp', src);
    await staticRemove(ctx, 'myapp');

    expect(existsSync(sitePath('myapp'))).toBe(false);
    expect(readState(dir).staticSources['myapp']).toBeUndefined();
  });

  it('lists sites with file counts and sources', async () => {
    await staticAdd(ctx, 'myapp', src);

    const chunks: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      chunks.push(a.map(String).join(' '));
    });
    staticList(context({ home: dir, json: true, yes: true }));
    spy.mockRestore();

    const parsed = JSON.parse(chunks.join('\n')) as {
      sites: Array<{ name: string; files: number; source: string | null; containerPath: string }>;
    };
    expect(parsed.sites).toHaveLength(1);
    expect(parsed.sites[0]).toMatchObject({
      name: 'myapp',
      files: 2,
      source: src,
      containerPath: '/srv/static/myapp',
    });
  });

  it('writes and removes the nginx host mount override', async () => {
    const override = join(dir, 'docker-compose.override.yml');

    await staticMount(ctx, src);
    const yaml = readFileSync(override, 'utf8');
    expect(yaml).toContain(`"${src}:${src}:ro"`);
    expect(yaml).toContain('nginx:');

    await staticUnmount(ctx);
    expect(existsSync(override)).toBe(false);
  });

  it('refuses to mount a directory that does not exist', async () => {
    await expect(staticMount(ctx, join(src, 'nope'))).rejects.toThrow(UserError);
  });
});
