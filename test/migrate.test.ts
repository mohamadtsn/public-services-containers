import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCommand } from '../src/commands/migrate.js';
import { type Ctx, context } from '../src/context.js';
import { inContainer, purgeDataDirs, run } from '../src/docker.js';
import { LEGACY_INSTALL_DIR } from '../src/legacy.js';
import { UserError } from '../src/ui.js';

/**
 * Migration is exercised against a simulated v1 installation in a temp
 * directory, never the real one.
 *
 * A production v1 stack lives at LEGACY_INSTALL_DIR on developer machines and
 * `migrate` reads from it by default, so every test here passes an explicit
 * `from`, and one test asserts the simulated path is not the real one.
 */
describe('migrate from a simulated v1 installation', () => {
  let legacy: string;
  let home: string;
  let ctx: Ctx;
  let dockerOk = false;

  beforeEach(async () => {
    legacy = mkdtempSync(join(tmpdir(), 'pubservices-v1-'));
    home = mkdtempSync(join(tmpdir(), 'pubservices-v2-'));
    expect(legacy.startsWith(tmpdir())).toBe(true);
    expect(legacy).not.toBe(LEGACY_INSTALL_DIR);

    // Shape of a v1 install: compose file, .env, nginx config, certs, backups.
    writeFileSync(join(legacy, 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(legacy, '.env'), 'MYSQL_PORT=43306\nMYSQL_DATABASE=legacy_db\n');
    mkdirSync(join(legacy, 'nginx', 'site-enabled'), { recursive: true });
    mkdirSync(join(legacy, 'nginx', 'certificates'), { recursive: true });
    mkdirSync(join(legacy, 'nginx', 'static', 'oldsite'), { recursive: true });
    mkdirSync(join(legacy, 'backups'), { recursive: true });
    mkdirSync(join(legacy, 'data', 'mysql'), { recursive: true });
    mkdirSync(join(legacy, 'data', 'redis'), { recursive: true });
    writeFileSync(join(legacy, 'nginx', 'site-enabled', 'app.test.conf'), 'server {}\n');
    writeFileSync(join(legacy, 'nginx', 'certificates', 'app.test.crt'), 'CERT\n');
    writeFileSync(join(legacy, 'nginx', 'static', 'oldsite', 'index.html'), 'old site\n');
    writeFileSync(join(legacy, 'backups', 'backup_20260101_000000.tar.gz'), 'archive\n');

    dockerOk = (await run('docker', ['version', '--format', '{{.Server.Version}}'])).code === 0;
    if (dockerOk) {
      // Give the fake data files a container-owned uid, exactly like MySQL's.
      await inContainer(
        [{ host: join(legacy, 'data'), at: '/data' }],
        'echo ibdata > /data/mysql/ibdata1 && echo aof > /data/redis/appendonly.aof && chown -R 999:999 /data/mysql && chown -R 999:999 /data/redis',
      );
    }

    ctx = context({ home, yes: true });
  });

  afterEach(async () => {
    if (dockerOk) {
      await purgeDataDirs(legacy, ['mysql', 'redis']).catch(() => undefined);
      await purgeDataDirs(home, ['mysql', 'redis', 'minio']).catch(() => undefined);
    }
    rmSync(legacy, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('copies configuration, certificates, static sites and backups', async () => {
    await migrateCommand(ctx, { from: legacy, configOnly: true });

    expect(readFileSync(join(home, '.env'), 'utf8')).toContain('legacy_db');
    expect(readFileSync(join(home, 'nginx/site-enabled/app.test.conf'), 'utf8')).toBe('server {}\n');
    expect(readFileSync(join(home, 'nginx/certificates/app.test.crt'), 'utf8')).toBe('CERT\n');
    expect(readFileSync(join(home, 'nginx/static/oldsite/index.html'), 'utf8')).toBe('old site\n');
    expect(existsSync(join(home, 'backups/backup_20260101_000000.tar.gz'))).toBe(true);
  });

  it('leaves the source installation completely untouched', async () => {
    const before = readdirSync(legacy, { recursive: true }).map(String).sort();

    await migrateCommand(ctx, { from: legacy, configOnly: true });

    const after = readdirSync(legacy, { recursive: true }).map(String).sort();
    expect(after).toEqual(before);
    expect(readFileSync(join(legacy, '.env'), 'utf8')).toContain('legacy_db');
  });

  it.runIf(process.env['CI'] === undefined)(
    'copies container-owned data directories without root',
    async () => {
      if (!dockerOk) return;
      await migrateCommand(ctx, { from: legacy });

      // The invoking user cannot read these files directly; the copy runs in a
      // container, which is the whole point of the migration path.
      const listed = await inContainer(
        [{ host: join(home, 'data'), at: '/data', readonly: true }],
        'ls /data/mysql /data/redis',
      );
      expect(listed.stdout).toContain('ibdata1');
      expect(listed.stdout).toContain('appendonly.aof');
    },
    120_000,
  );

  it('refuses a source that is not a pubservices installation', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pubservices-empty-'));
    await expect(migrateCommand(ctx, { from: empty })).rejects.toThrow(UserError);
    rmSync(empty, { recursive: true, force: true });
  });

  it('refuses a missing source and a source equal to the destination', async () => {
    await expect(migrateCommand(ctx, { from: join(legacy, 'nope') })).rejects.toThrow(UserError);
    writeFileSync(join(home, 'docker-compose.yml'), 'services: {}\n');
    await expect(migrateCommand(ctx, { from: home })).rejects.toThrow(UserError);
  });
});
