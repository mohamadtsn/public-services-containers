import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves the published artifact works, not just the source tree.
 *
 * `npm pack` produces the exact tarball users install, and it is then installed
 * globally into a temp prefix — the same code path as `npm i -g pubservices`,
 * including the `bin` entry. Catches what source tests cannot: a template left
 * out of `files`, a broken bin field, or a runtime dependency listed as a dev
 * dependency. The temp prefix also demonstrates the install needing no root.
 */
const repo = resolve(import.meta.dirname, '..');

describe('published package', () => {
  let staging: string;
  let prefix: string;
  let pkgDir: string;
  let binary: string;
  let home: string;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'ignore' });

    staging = mkdtempSync(join(tmpdir(), 'pubservices-pack-'));
    prefix = mkdtempSync(join(tmpdir(), 'pubservices-prefix-'));
    home = mkdtempSync(join(tmpdir(), 'pubservices-packhome-'));

    const output = execFileSync('npm', ['pack', '--pack-destination', staging], {
      cwd: repo,
      encoding: 'utf8',
    });
    const tarball = join(staging, output.trim().split('\n').pop()!);
    execFileSync('tar', ['-xzf', tarball, '-C', staging]);

    // A user-owned prefix: this is what `npm i -g` does when npm is not
    // installed under root, and it is why v2 needs no sudo to install.
    execFileSync(
      'npm',
      ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball],
      { stdio: 'ignore' },
    );
    pkgDir = join(prefix, 'lib', 'node_modules', 'pubservices');
    binary = join(prefix, 'bin', 'pubservices');
  }, 300_000);

  afterAll(() => {
    for (const path of [staging, prefix, home]) rmSync(path, { recursive: true, force: true });
  });

  /** Invokes the installed `pubservices` binary, exactly as a user would. */
  const cli = (...args: string[]): string =>
    execFileSync(binary, args, {
      encoding: 'utf8',
      env: { ...process.env, PUBSERVICES_HOME: home, NO_COLOR: '1' },
    });

  it('installs an executable binary on PATH', () => {
    expect(existsSync(binary)).toBe(true);
    expect(cli('--version').trim()).toBe(
      JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
    );
  });

  it('ships every template the first run seeds from', () => {
    for (const file of [
      'templates/docker-compose.yml',
      'templates/.env.example',
      'templates/nginx/Dockerfile',
      'templates/nginx/settings/nginx.conf',
      'templates/nginx/site-enabled/default.conf',
      'templates/mysql/conf.d/custom.cnf',
      'dist/cli.js',
    ]) {
      expect(existsSync(join(pkgDir, file)), `missing from package: ${file}`).toBe(true);
    }
  });

  it('does not create a home directory just to print the version', () => {
    cli('--version');
    expect(existsSync(join(home, '.env'))).toBe(false);
  });

  it('bootstraps a fresh home directory on the first real command', () => {
    cli('--json', 'status');

    expect(existsSync(join(home, '.env'))).toBe(true);
    expect(existsSync(join(home, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(join(home, 'nginx', 'Dockerfile'))).toBe(true);
    expect(existsSync(join(home, 'mysql', 'conf.d', 'custom.cnf'))).toBe(true);
    expect(existsSync(join(home, 'data', 'mysql'))).toBe(true);

    // The seeded compose file must still reference the fixed ecosystem names.
    const compose = readFileSync(join(home, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('mysql-main');
    expect(compose).toContain('public-service-network');
  });

  it('runs its read-only commands from the packed build', () => {
    const status = JSON.parse(cli('--json', 'status')) as { services: unknown[] };
    expect(status.services).toHaveLength(6);

    const info = JSON.parse(cli('--json', 'info')) as { mysql: { port: number } };
    expect(info.mysql.port).toBe(43306);

    expect(cli('home').trim()).toBe(home);
  });

  it('generates a syntactically valid bash completion from the packed build', () => {
    const script = join(staging, 'completion.bash');
    writeFileSync(script, cli('completion', 'show', 'bash'));
    expect(() => execFileSync('bash', ['-n', script])).not.toThrow();
  });
});
