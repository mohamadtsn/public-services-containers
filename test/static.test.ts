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
import { readState, updateState } from '../src/state.js';
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

  it('detects a Vite project and syncs its dist/ output', async () => {
    const viteDir = tempDir('pubservices-vite-');
    writeFileSync(join(viteDir, 'vite.config.ts'), 'export default {}');
    mkdirSync(join(viteDir, 'dist'), { recursive: true });
    writeFileSync(join(viteDir, 'dist', 'index.html'), '<html>vite</html>');

    await staticAdd(ctx, 'viteapp', viteDir);

    expect(readFileSync(join(sitePath('viteapp'), 'index.html'), 'utf8')).toBe('<html>vite</html>');

    const state = readState(dir);
    expect(state.staticSites['viteapp']).toBeDefined();
    expect(state.staticSites['viteapp']?.type).toBe('vite');
    expect(state.staticSites['viteapp']?.deployMode).toBe('static');
  });

  it('detects a Next.js export project and syncs its out/ output', async () => {
    const nextDir = tempDir('pubservices-next-');
    writeFileSync(join(nextDir, 'next.config.mjs'), 'export default { output: "export" }');
    mkdirSync(join(nextDir, 'out'), { recursive: true });
    writeFileSync(join(nextDir, 'out', 'index.html'), '<html>next</html>');

    await staticAdd(ctx, 'nextapp', nextDir);

    expect(readFileSync(join(sitePath('nextapp'), 'index.html'), 'utf8')).toBe('<html>next</html>');

    const state = readState(dir);
    expect(state.staticSites['nextapp']).toBeDefined();
    expect(state.staticSites['nextapp']?.type).toBe('nextjs');
    expect(state.staticSites['nextapp']?.deployMode).toBe('static');
  });

  it('falls back to direct sync for plain build output directories', async () => {
    const plainDir = tempDir('pubservices-plain-');
    writeFileSync(join(plainDir, 'index.html'), '<html>plain</html>');
    writeFileSync(join(plainDir, 'app.js'), 'console.log("plain")');

    await staticAdd(ctx, 'plain', plainDir);

    expect(readFileSync(join(sitePath('plain'), 'index.html'), 'utf8')).toBe('<html>plain</html>');
    expect(readFileSync(join(sitePath('plain'), 'app.js'), 'utf8')).toBe('console.log("plain")');

    const state = readState(dir);
    expect(state.staticSites['plain']?.type).toBe('static');
  });

  it('saves framework metadata in staticSites state', async () => {
    const viteDir = tempDir('pubservices-vitemeta-');
    writeFileSync(join(viteDir, 'vite.config.ts'), 'export default {}');
    mkdirSync(join(viteDir, 'dist'), { recursive: true });
    writeFileSync(join(viteDir, 'dist', 'index.html'), '<html>meta</html>');

    await staticAdd(ctx, 'viteapp', viteDir);

    const info = readState(dir).staticSites['viteapp'];
    expect(info).toBeDefined();
    expect(info?.source).toBe(viteDir);
    expect(info?.type).toBe('vite');
    expect(info?.deployMode).toBe('static');
  });

  it('--no-build flag prevents build attempt', async () => {
    const viteDir = tempDir('pubservices-nobuild-');
    writeFileSync(join(viteDir, 'vite.config.ts'), 'export default {}');
    // No dist/ directory — output doesn't exist.

    await expect(staticAdd(ctx, 'nobuilt', viteDir, { noBuild: true })).rejects.toThrow(UserError);
  });

  it('detects a Nuxt static project and syncs .output/public', async () => {
    const nuxtDir = tempDir('pubservices-nuxt-');
    writeFileSync(join(nuxtDir, 'nuxt.config.ts'), 'export default { ssr: false }');
    mkdirSync(join(nuxtDir, '.output', 'public'), { recursive: true });
    writeFileSync(join(nuxtDir, '.output', 'public', 'index.html'), '<html>nuxt-static</html>');

    await staticAdd(ctx, 'nuxtapp', nuxtDir);

    expect(readFileSync(join(sitePath('nuxtapp'), 'index.html'), 'utf8')).toBe('<html>nuxt-static</html>');

    const state = readState(dir);
    expect(state.staticSites['nuxtapp']).toBeDefined();
    expect(state.staticSites['nuxtapp']?.type).toBe('nuxt');
    expect(state.staticSites['nuxtapp']?.deployMode).toBe('static');
  });

  it('lists SSR sites and static sites together in json mode', () => {
    updateState(dir, {
      staticSites: {
        ssrapp: {
          source: '/path/to/ssr',
          type: 'nextjs',
          deployMode: 'ssr',
          outputMode: 'standalone',
          port: 48001,
        },
      },
    });

    const chunks: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      chunks.push(a.map(String).join(' '));
    });
    staticList(context({ home: dir, json: true, yes: true }));
    spy.mockRestore();

    const parsed = JSON.parse(chunks.join('\n')) as {
      sites: Array<{ name: string; deployMode: string; type: string; port: number | null }>;
    };
    const ssrSite = parsed.sites.find((s) => s.name === 'ssrapp');
    expect(ssrSite).toBeDefined();
    expect(ssrSite?.deployMode).toBe('ssr');
    expect(ssrSite?.type).toBe('nextjs');
    expect(ssrSite?.port).toBe(48001);
  });
});

