import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../src/commands/doctor.js';
import { infoCommand } from '../src/commands/info.js';
import { statusCommand } from '../src/commands/status.js';
import { type Ctx, context } from '../src/context.js';

/**
 * Container names are deliberately overridden to non-existent ones so no test
 * ever inspects, let alone touches, the containers of a live stack.
 */
const ISOLATED_ENV = [
  'MYSQL_CONTAINER_NAME=pubservices-test-mysql',
  'REDIS_CONTAINER_NAME=pubservices-test-redis',
  'NGINX_CONTAINER_NAME=pubservices-test-nginx',
  'PMA_CONTAINER_NAME=pubservices-test-pma',
  'MAILPIT_CONTAINER_NAME=pubservices-test-mailpit',
  'MINIO_CONTAINER_NAME=pubservices-test-minio',
  'MYSQL_PORT=13306',
  'PMA_BLOWFISH_SECRET=0123456789abcdef0123456789abcdef',
].join('\n');

function captureStdout(): { lines: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  });
  return { lines: () => chunks.join('\n'), restore: () => spy.mockRestore() };
}

describe('read-only commands', () => {
  let dir: string;
  let ctx: Ctx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-cmd-'));
    context({ home: dir }); // seed the layout
    writeFileSync(join(dir, '.env'), `${ISOLATED_ENV}\n`);
    ctx = context({ home: dir, json: true, yes: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('status reports every service with a resolved state', async () => {
    const out = captureStdout();
    await statusCommand(ctx);
    const parsed = JSON.parse(out.lines()) as {
      home: string;
      services: Array<{ key: string; container: string; status: string }>;
    };
    out.restore();

    expect(parsed.home).toBe(dir);
    expect(parsed.services).toHaveLength(6);
    // Nothing named pubservices-test-* exists, so every state must be 'missing'.
    expect(parsed.services.every((s) => s.status === 'missing')).toBe(true);
    expect(parsed.services.every((s) => s.container.startsWith('pubservices-test-'))).toBe(true);
  });

  it('info builds connection URLs from .env', async () => {
    const out = captureStdout();
    infoCommand(ctx);
    const parsed = JSON.parse(out.lines()) as { mysql: { port: number; url: string } };
    out.restore();

    expect(parsed.mysql.port).toBe(13306);
    expect(parsed.mysql.url).toContain(':13306/');
  });

  it('doctor returns checks and does not fail on a healthy home', async () => {
    const out = captureStdout();
    await doctorCommand(ctx);
    const parsed = JSON.parse(out.lines()) as { checks: Array<{ name: string; level: string }> };
    out.restore();

    const byName = new Map(parsed.checks.map((c) => [c.name, c.level]));
    expect(byName.get('home')).toBe('ok');
    expect(byName.get('.env')).toBe('ok');
    expect(byName.get('pma secret')).toBe('ok');
  });

  it('doctor flags a wrong-length phpMyAdmin secret', async () => {
    writeFileSync(join(dir, '.env'), 'PMA_BLOWFISH_SECRET=too-short\n');
    const out = captureStdout();
    await doctorCommand(context({ home: dir, json: true }));
    const parsed = JSON.parse(out.lines()) as { checks: Array<{ name: string; level: string }> };
    out.restore();

    expect(parsed.checks.find((c) => c.name === 'pma secret')?.level).toBe('warn');
  });
});

describe('shipped template .env.example', () => {
  it('has a phpMyAdmin secret of exactly 32 characters', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync(new URL('../templates/.env.example', import.meta.url), 'utf8');
    const secret = /^PMA_BLOWFISH_SECRET=(.*)$/m.exec(example)?.[1] ?? '';
    expect(secret).toHaveLength(32);
  });
});
