import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, services } from '../src/env.js';
import { ensureHome, resolveHome } from '../src/home.js';
import { readState, updateState } from '../src/state.js';
import { box, pad, stripAnsi, width } from '../src/ui.js';

const ESC = String.fromCharCode(27);
const red = (s: string) => `${ESC}[31m${s}${ESC}[0m`;

describe('ui', () => {
  it('measures and pads ignoring color codes', () => {
    expect(width(red('abc'))).toBe(3);
    expect(stripAnsi(pad(red('abc'), 6))).toBe('abc   ');
  });

  it('keeps box borders aligned when cells are colored', () => {
    const rendered = box({
      title: 'T',
      tag: 'v1',
      rows: [
        ['MySQL', red('healthy'), 'localhost:43306'],
        ['Nginx', 'stopped', ':80 / :443'],
      ],
    });
    const widths = new Set(rendered.split('\n').map((l) => width(stripAnsi(l))));
    expect(widths.size).toBe(1);
  });
});

describe('home', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-test-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves an explicit override over the environment', () => {
    expect(resolveHome(join(dir, 'x'))).toBe(join(dir, 'x'));
  });

  it('seeds the layout and .env on first run, and is idempotent', () => {
    const home = join(dir, 'home');
    const first = ensureHome(home);

    expect(first.created).toBe(true);
    expect(existsSync(join(home, '.env'))).toBe(true);
    expect(existsSync(join(home, 'data/mysql'))).toBe(true);
    expect(existsSync(join(home, 'docker-compose.yml'))).toBe(true);
    expect(readState(home).version).not.toBe('');

    // A user edit to .env must survive the next run.
    writeFileSync(join(home, '.env'), 'MYSQL_PORT=55555\n');
    const second = ensureHome(home);
    expect(second.created).toBe(false);
    expect(second.seeded).toBe(false);
    expect(readFileSync(join(home, '.env'), 'utf8')).toContain('55555');
  });

  it('re-seeds templates when the recorded version is stale', () => {
    const home = join(dir, 'home');
    ensureHome(home);
    updateState(home, { version: '0.0.0-old' });
    expect(ensureHome(home).seeded).toBe(true);
  });
});

describe('env', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-env-'));
    ensureHome(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('applies compose defaults and lets .env override them', () => {
    writeFileSync(join(dir, '.env'), 'MYSQL_PORT=1234\n');
    const env = loadEnv(dir);
    expect(env.MYSQL_PORT).toBe('1234');
    // Contract with local-dev-proxy: these names must not drift.
    expect(env.NGINX_CONTAINER_NAME).toBe('nginx-main');
    expect(env.NETWORK_NAME).toBe('public-service-network');
  });

  it('exposes every service with a container name and address', () => {
    const list = services(loadEnv(dir));
    expect(list.map((s) => s.key)).toEqual([
      'mysql',
      'redis',
      'nginx',
      'phpmyadmin',
      'mailpit',
      'minio',
    ]);
    expect(list.every((s) => s.container && s.address)).toBe(true);
  });
});
