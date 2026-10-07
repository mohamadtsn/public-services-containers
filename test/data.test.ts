import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupCommand, listBackups } from '../src/commands/backup.js';
import { upCommand } from '../src/commands/lifecycle.js';
import { resetCommand } from '../src/commands/reset.js';
import { restoreCommand } from '../src/commands/restore.js';
import { context } from '../src/context.js';
import { run } from '../src/docker.js';
import { PREFIX, type Sandbox, createSandbox, dockerReady, waitFor } from './sandbox.js';

/**
 * Round-trips real data through backup and restore in the sandbox stack.
 *
 * MySQL is started here (unlike the lifecycle suite) because the restore path
 * pipes a dump into a running server — the single most destructive operation in
 * the CLI. Proving it on a throwaway database is worth the extra startup time.
 */
const ready = await dockerReady();
const suite = ready ? describe : describe.skip;

suite('backup, restore and reset', () => {
  let sandbox: Sandbox;
  let mysql: string;
  let redis: string;

  const ctx = () => context({ home: sandbox.home, yes: true, json: false });

  const sql = (statement: string) =>
    run('docker', [
      'exec',
      '-e',
      `MYSQL_PWD=${sandbox.ctx.env.MYSQL_ROOT_PASSWORD}`,
      mysql,
      'mysql',
      '-u',
      'root',
      '-N',
      '-B',
      '-e',
      statement,
    ]);

  const redisCli = (...args: string[]) =>
    run('docker', ['exec', redis, 'redis-cli', ...args]);

  beforeAll(async () => {
    sandbox = await createSandbox();
    mysql = sandbox.ctx.env.MYSQL_CONTAINER_NAME;
    redis = sandbox.ctx.env.REDIS_CONTAINER_NAME;
    expect(mysql.startsWith(PREFIX) && redis.startsWith(PREFIX)).toBe(true);

    await upCommand(context({ home: sandbox.home, yes: true, json: true }), undefined, {});
    expect(await waitFor(mysql, 'health', ['healthy'], 180_000)).toBe('healthy');
    expect(await waitFor(redis, 'health', ['healthy'], 60_000)).toBe('healthy');
  }, 240_000);

  afterAll(async () => {
    await sandbox?.destroy();
  }, 120_000);

  it('backs up seeded MySQL and Redis data', async () => {
    await sql('CREATE DATABASE IF NOT EXISTS roundtrip;');
    await sql('CREATE TABLE roundtrip.t (id INT PRIMARY KEY, note VARCHAR(32));');
    await sql("INSERT INTO roundtrip.t VALUES (1, 'before-backup');");
    await redisCli('SET', 'roundtrip:key', 'before-backup');

    await backupCommand(ctx());

    const backups = listBackups(sandbox.home);
    expect(backups).toHaveLength(1);
    expect(existsSync(backups[0]!.path)).toBe(true);
    expect(backups[0]!.size).toBeGreaterThan(0);
  }, 120_000);

  it('restores data that was destroyed after the backup', async () => {
    await sql('DROP DATABASE roundtrip;');
    await redisCli('DEL', 'roundtrip:key');

    expect((await sql("SHOW DATABASES LIKE 'roundtrip';")).stdout.trim()).toBe('');
    expect((await redisCli('GET', 'roundtrip:key')).stdout.trim()).toBe('');

    await restoreCommand(ctx(), listBackups(sandbox.home)[0]!.path);
    expect(await waitFor(redis, 'health', ['healthy'], 60_000)).toBe('healthy');

    expect((await sql('SELECT note FROM roundtrip.t WHERE id = 1;')).stdout.trim()).toBe(
      'before-backup',
    );
    expect((await redisCli('GET', 'roundtrip:key')).stdout.trim()).toBe('before-backup');
  }, 180_000);

  it('reset clears container-owned data without root', async () => {
    // The whole point: MySQL's files belong to uid 999, so this would need
    // `sudo rm -rf` if it were done from the host.
    await resetCommand(ctx());

    const dataDir = join(sandbox.home, 'data');
    expect(readdirSync(join(dataDir, 'mysql'))).toHaveLength(0);
    expect(readdirSync(join(dataDir, 'redis'))).toHaveLength(0);

    // Backups survive a reset.
    expect(listBackups(sandbox.home)).toHaveLength(1);
  }, 120_000);

  it('kept every container inside its own prefix', async () => {
    const { stdout } = await run('docker', ['ps', '-a', '--format', '{{.Names}}']);
    const mine = stdout.split('\n').filter((n) => n.includes('psvc'));
    for (const name of mine) expect(name.startsWith(PREFIX)).toBe(true);
  }, 30_000);
});
