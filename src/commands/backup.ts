import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type Ctx, emitJson } from '../context.js';
import { compose, inspectMany, run } from '../docker.js';
import { packageVersion } from '../home.js';
import { confirm } from '../prompt.js';
import { UserError, color, say } from '../ui.js';

export const MANIFEST = 'manifest.json';

export interface Manifest {
  format: 1;
  createdBy: string;
  createdAt: string;
  contents: { mysql: boolean; redis: boolean };
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function isRunning(container: string): Promise<boolean> {
  const state = (await inspectMany([container])).get(container);
  return state !== undefined && state !== 'missing' && state !== 'stopped';
}

export async function backupCommand(ctx: Ctx): Promise<void> {
  const mysql = ctx.env.MYSQL_CONTAINER_NAME;
  const redis = ctx.env.REDIS_CONTAINER_NAME;

  const dir = join(ctx.home, 'backups');
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, `backup_${timestamp()}.tar.gz`);

  const staging = mkdtempSync(join(tmpdir(), 'pubservices-backup-'));
  const contents = { mysql: false, redis: false };

  try {
    if (await isRunning(mysql)) {
      say.step('Dumping MySQL databases...');
      // The password goes through the environment, not argv, so it does not
      // appear in the container's process list.
      const res = await run(
        'docker',
        [
          'exec',
          '-e',
          `MYSQL_PWD=${ctx.env.MYSQL_ROOT_PASSWORD}`,
          mysql,
          'mysqldump',
          '-u',
          'root',
          '--all-databases',
          '--single-transaction',
        ],
        { stdoutFile: join(staging, 'mysql_all.sql') },
      );
      if (res.code !== 0) {
        throw new UserError('mysqldump failed.', (res.stderr || '').trim().split('\n').slice(-3).join('\n'));
      }
      contents.mysql = true;
      say.ok('MySQL dump complete.');
    } else {
      say.warn(`MySQL container '${mysql}' is not running — skipping.`);
    }

    if (await isRunning(redis)) {
      say.step('Copying Redis data...');
      // Copies the whole /data directory: Redis 7 keeps its AOF in
      // appendonlydir/, which the old single-file copy silently missed.
      mkdirSync(join(staging, 'redis'), { recursive: true });
      const res = await run('docker', ['cp', `${redis}:/data/.`, join(staging, 'redis')]);
      if (res.code !== 0) {
        throw new UserError('Could not copy Redis data.', (res.stderr || '').trim());
      }
      contents.redis = true;
      say.ok('Redis data copied.');
    } else {
      say.warn(`Redis container '${redis}' is not running — skipping.`);
    }

    if (!contents.mysql && !contents.redis) {
      throw new UserError(
        'Nothing to back up — no service was running.',
        'Start the stack first: pubservices up',
      );
    }

    const manifest: Manifest = {
      format: 1,
      createdBy: `pubservices ${packageVersion()}`,
      createdAt: new Date().toISOString(),
      contents,
    };
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

    const tar = await run('tar', ['-czf', archive, '-C', staging, '.']);
    if (tar.code !== 0) throw new UserError('Could not create the archive.', tar.stderr.trim());
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const size = statSync(archive).size;
  if (ctx.json) {
    emitJson({ archive, size, contents });
    return;
  }
  say.blank();
  say.ok(`Backup saved: ${archive} ${color.meta(`(${(size / 1_048_576).toFixed(1)} MB)`)}`);
  say.blank();
}

export interface BackupEntry {
  file: string;
  path: string;
  size: number;
  mtime: number;
}

/** Backups in the home directory, newest first. */
export function listBackups(home: string): BackupEntry[] {
  const dir = join(home, 'backups');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => {
      const path = join(dir, f);
      const st = statSync(path);
      return { file: f, path, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export async function backupsCommand(ctx: Ctx): Promise<void> {
  const entries = listBackups(ctx.home);

  if (ctx.json) {
    emitJson({ home: ctx.home, backups: entries });
    return;
  }

  say.blank();
  console.log(`  ${color.brand(color.bold('Backups'))}  ${color.meta(join(ctx.home, 'backups'))}`);
  say.blank();
  if (entries.length === 0) {
    say.meta('  None yet — create one with: pubservices backup');
  } else {
    for (const e of entries) {
      const when = new Date(e.mtime).toLocaleString();
      console.log(
        `  ${basename(e.file)}  ${color.meta(`${(e.size / 1_048_576).toFixed(1)} MB · ${when}`)}`,
      );
    }
  }
  say.blank();
}

/** Prunes old archives, keeping the newest `keep`. */
export async function pruneBackups(ctx: Ctx, keep: number): Promise<void> {
  const stale = listBackups(ctx.home).slice(keep);
  if (stale.length === 0) {
    say.ok(`Nothing to prune — ${listBackups(ctx.home).length} backup(s) kept.`);
    return;
  }
  if (!(await confirm(ctx, `Delete ${stale.length} old backup(s), keeping the newest ${keep}?`))) {
    say.meta('Cancelled.');
    return;
  }
  // Archives are written by this CLI as the invoking user, so a plain unlink works.
  for (const e of stale) rmSync(e.path, { force: true });
  say.ok(`Removed ${stale.length} old backup(s).`);
}

/** Exposed for restore: stopping and starting a single service. */
export async function composeService(
  ctx: Ctx,
  action: 'stop' | 'start',
  service: string,
): Promise<void> {
  const res = await compose(ctx.home, [action, service]);
  if (res.code !== 0) {
    throw new UserError(`Could not ${action} ${service}.`, (res.stderr || res.stdout).trim());
  }
}
