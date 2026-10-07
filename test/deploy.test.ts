import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocatePort, regenerateAppsCompose, removeSsr } from '../src/commands/deploy.js';
import { type Ctx, context } from '../src/context.js';
import { readState, updateState } from '../src/state.js';

describe('deploy module', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-deploy-'));
    ctx = context({ home: dir, yes: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('allocates ports sequentially starting from default', () => {
    const port1 = allocatePort(dir);
    const port2 = allocatePort(dir);
    const port3 = allocatePort(dir);

    expect(port1).toBe(48001);
    expect(port2).toBe(48002);
    expect(port3).toBe(48003);

    const state = readState(dir);
    expect(state.nextAppPort).toBe(48004);
  });

  it('regenerates compose with Next.js standalone service', () => {
    updateState(dir, {
      staticSites: {
        nextapp: {
          source: '/home/user/nextapp',
          type: 'nextjs',
          deployMode: 'ssr',
          outputMode: 'standalone',
          port: 48001,
        },
      },
    });

    regenerateAppsCompose(ctx);

    const composePath = join(dir, 'docker-compose.apps.yml');
    expect(existsSync(composePath)).toBe(true);

    const content = readFileSync(composePath, 'utf8');
    expect(content).toContain('nextapp:');
    expect(content).toContain("image: node:20-alpine");
    expect(content).toContain("command: ['node', '.next/standalone/server.js']");
    expect(content).toContain("'/home/user/nextapp:/app:ro'");
    expect(content).toContain("ports:\n      - '48001:3000'");
    expect(content).toContain('public-service-network');
  });

  it('regenerates compose with Next.js default SSR service', () => {
    updateState(dir, {
      staticSites: {
        nextdefault: {
          source: '/home/user/nextdefault',
          type: 'nextjs',
          deployMode: 'ssr',
          outputMode: 'default',
          port: 48002,
        },
      },
    });

    regenerateAppsCompose(ctx);

    const composePath = join(dir, 'docker-compose.apps.yml');
    expect(existsSync(composePath)).toBe(true);

    const content = readFileSync(composePath, 'utf8');
    expect(content).toContain('nextdefault:');
    expect(content).toContain("command: ['node_modules/.bin/next', 'start']");
    expect(content).toContain("ports:\n      - '48002:3000'");
  });

  it('regenerates compose with Nuxt SSR service', () => {
    updateState(dir, {
      staticSites: {
        nuxtapp: {
          source: '/home/user/nuxtapp',
          type: 'nuxt',
          deployMode: 'ssr',
          outputMode: 'server',
          port: 48003,
        },
      },
    });

    regenerateAppsCompose(ctx);

    const composePath = join(dir, 'docker-compose.apps.yml');
    expect(existsSync(composePath)).toBe(true);

    const content = readFileSync(composePath, 'utf8');
    expect(content).toContain('nuxtapp:');
    expect(content).toContain("command: ['node', 'server/index.mjs']");
    expect(content).toContain("'/home/user/nuxtapp/.output:/app:ro'");
    expect(content).toContain('NITRO_PORT');
    expect(content).toContain("ports:\n      - '48003:3000'");
  });

  it('removes compose file when no SSR sites exist', () => {
    updateState(dir, {
      staticSites: {
        staticonly: {
          source: '/home/user/static',
          type: 'static',
          deployMode: 'static',
        },
      },
    });

    regenerateAppsCompose(ctx);

    const composePath = join(dir, 'docker-compose.apps.yml');
    expect(existsSync(composePath)).toBe(false);
  });

  it('removes SSR site from state and compose file on removeSsr', async () => {
    updateState(dir, {
      staticSites: {
        myapp: {
          source: '/home/user/myapp',
          type: 'nextjs',
          deployMode: 'ssr',
          outputMode: 'standalone',
          port: 48001,
        },
      },
    });

    regenerateAppsCompose(ctx);
    expect(existsSync(join(dir, 'docker-compose.apps.yml'))).toBe(true);

    await removeSsr(ctx, 'myapp');

    const state = readState(dir);
    expect(state.staticSites['myapp']).toBeUndefined();
    expect(existsSync(join(dir, 'docker-compose.apps.yml'))).toBe(false);
  });
});
