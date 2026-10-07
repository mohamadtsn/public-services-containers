import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { select, isCancel } from '@clack/prompts';
import type { Ctx } from '../context.js';
import { inspectMany, run } from '../docker.js';
import { MANIFEST, type Manifest, composeService, listBackups } from './backup.js';
import { confirm } from '../prompt.js';
import { UserError, color, say } from '../ui.js';

function expand(p: string): string {
  return resolve(p.replace(/^~(?=$|\/)/, homedir()));
}

/** No argument: offer the archives already in the home directory, newest first. */
async function pickArchive(ctx: Ctx): Promise<string> {
  const entries = listBackups(ctx.home);
  if (entries.length === 0) {
    throw new UserError(
      'No backup file given and none found in the home directory.',
      `Pass a path, or create one first: pubservices backup`,
    );
  }
  if (ctx.yes) return entries[0]!.path;

  const answer = await select({
    message: 'Which backup do you want to restore?',
    options: entries.map((e) => ({
      value: e.path,
      label: e.file,
      hint: `${(e.size / 1_048_576).toFixed(1)} MB · ${new Date(e.mtime).toLocaleString()}`,
    })),
  });
  if (isCancel(answer)) throw new UserError('Cancelled.');
  return answer as string;
}

function readManifest(dir: string): Manifest | null {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

export async function restoreCommand(ctx: Ctx, fileArg: string | undefined): Promise<void> {
  const archive = fileArg ? expand(fileArg) : await pickArchive(ctx);
  if (!existsSync(archive)) throw new UserError(`File not found: ${archive}`);

  const staging = mkdtempSync(join(tmpdir(), 'pubservices-restore-'));

  try {
    const extract = await run('tar', ['-xzf', archive, '-C', staging]);
    if (extract.code !== 0) {
      throw new UserError('Could not read the archive.', extract.stderr.trim());
    }

    const manifest = readManifest(staging);
    const sqlFile = join(staging, 'mysql_all.sql');
    const redisDir = join(staging, 'redis');
    const sqlPgFile = join(staging, 'postgres_all.sql');
    // Archives from v1 have no manifest: fall back to what is actually present.
    const hasMysql = manifest?.contents.mysql ?? existsSync(sqlFile);
    const hasRedis = manifest?.contents.redis ?? existsSync(redisDir);
    const hasPostgres = manifest?.contents.postgres ?? existsSync(sqlPgFile);

    say.blank();
    say.meta(`  archive  ${archive}`);
    if (manifest) say.meta(`  created  ${manifest.createdAt} by ${manifest.createdBy}`);
    say.meta(
      `  contains ${[hasMysql && 'MySQL', hasRedis && 'Redis', hasPostgres && 'PostgreSQL'].filter(Boolean).join(', ') || 'nothing'}`,
    );
    say.blank();

    if (!hasMysql && !hasRedis && !hasPostgres) throw new UserError('This archive contains no restorable data.');

    if (!(await confirm(ctx, `Overwrite current data with this backup?`))) {
      say.meta('Cancelled.');
      return;
    }

    if (hasMysql) await restoreMysql(ctx, sqlFile);
    if (hasRedis) await restoreRedis(ctx, redisDir);
    if (hasPostgres) await restorePostgres(ctx, sqlPgFile);

    say.blank();
    say.ok('Restore complete.');
    say.blank();
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function restoreMysql(ctx: Ctx, sqlFile: string): Promise<void> {
  const container = ctx.env.MYSQL_CONTAINER_NAME;
  const state = (await inspectMany([container])).get(container);
  if (!state || state === 'missing' || state === 'stopped') {
    throw new UserError(
      `MySQL container '${container}' is not running — cannot restore.`,
      'Start it first: pubservices up',
    );
  }

  say.step('Restoring MySQL...');
  const res = await run(
    'docker',
    ['exec', '-i', '-e', `MYSQL_PWD=${ctx.env.MYSQL_ROOT_PASSWORD}`, container, 'mysql', '-u', 'root'],
    { stdinFile: sqlFile },
  );
  if (res.code !== 0) {
    throw new UserError('MySQL restore failed.', (res.stderr || '').trim().split('\n').slice(-3).join('\n'));
  }
  say.ok('MySQL restored.');
}

async function restorePostgres(ctx: Ctx, sqlFile: string): Promise<void> {
  const container = ctx.env.POSTGRES_CONTAINER_NAME;
  const state = (await inspectMany([container])).get(container);
  if (!state || state === 'missing' || state === 'stopped') {
    throw new UserError(
      `PostgreSQL container '${container}' is not running — cannot restore.`,
      'Start it first: pubservices up --postgres',
    );
  }

  say.step('Restoring PostgreSQL...');
  const res = await run(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${ctx.env.POSTGRES_PASSWORD}`,
      container,
      'psql',
      '-U',
      ctx.env.POSTGRES_USER,
      '-d',
      ctx.env.POSTGRES_DB,
    ],
    { stdinFile: sqlFile },
  );
  if (res.code !== 0) {
    throw new UserError('PostgreSQL restore failed.', (res.stderr || '').trim().split('\n').slice(-3).join('\n'));
  }
  say.ok('PostgreSQL restored.');
}

async function restoreRedis(ctx: Ctx, redisDir: string): Promise<void> {
  const container = ctx.env.REDIS_CONTAINER_NAME;
  const state = (await inspectMany([container])).get(container);
  if (!state || state === 'missing') {
    throw new UserError(`Redis container '${container}' does not exist — cannot restore.`);
  }

  say.step('Restoring Redis...');
  // Redis rewrites its AOF on shutdown, so it must be stopped before the files
  // are replaced — otherwise it would overwrite the restored data on exit.
  const wasRunning = state !== 'stopped';
  if (wasRunning) await composeService(ctx, 'stop', 'redis');

  const res = await run('docker', ['cp', `${redisDir}/.`, `${container}:/data`]);
  if (res.code !== 0) {
    if (wasRunning) await composeService(ctx, 'start', 'redis');
    throw new UserError('Could not copy Redis data back.', (res.stderr || '').trim());
  }

  if (wasRunning) await composeService(ctx, 'start', 'redis');
  say.ok(`Redis restored${wasRunning ? ' and restarted' : ''}.`);
}

export function restoreHint(): string {
  return `${color.meta('Tip: run')} pubservices backup ${color.meta('before restoring, so you can undo it.')}`;
}
