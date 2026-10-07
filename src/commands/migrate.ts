import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Ctx, emitJson } from '../context.js';
import { containersUsingPath, inContainer } from '../docker.js';
import { services } from '../env.js';
import { LEGACY_INSTALL_DIR } from '../legacy.js';
import { confirm } from '../prompt.js';
import { UserError, color, say, tildify } from '../ui.js';

export interface MigrateOptions {
  /** Source installation; defaults to the v1 install path. Overridable for tests. */
  from?: string;
  /** Copy configuration only and leave data/ alone. */
  configOnly?: boolean;
}

/** Config that is safe to copy while services run — plain files owned by the user. */
const CONFIG_ENTRIES = [
  '.env',
  'nginx/site-enabled',
  'nginx/certificates',
  'nginx/static',
  'backups',
];

const DATA_DIRS = ['mysql', 'redis', 'minio'];

interface Copied {
  entry: string;
  from: string;
  to: string;
}

/**
 * Moves a v1 installation into the v2 home directory.
 *
 * Strictly read-only with respect to the source: nothing under `from` is
 * written, renamed or deleted, and the old installation keeps working until the
 * user removes it themselves. That matters because the source is usually a
 * live stack — `/usr/local/lib/public-services-containers` — with real data in it.
 */
export async function migrateCommand(ctx: Ctx, opts: MigrateOptions = {}): Promise<void> {
  const from = resolve(opts.from ?? LEGACY_INSTALL_DIR);

  if (!existsSync(from)) {
    throw new UserError(`No installation found at ${from}`, 'Nothing to migrate.');
  }
  if (resolve(from) === resolve(ctx.home)) {
    throw new UserError('The source and the destination are the same directory.');
  }
  if (!existsSync(join(from, 'docker-compose.yml'))) {
    throw new UserError(
      `${from} does not look like a pubservices installation.`,
      'Expected a docker-compose.yml inside it.',
    );
  }

  // Copying a database directory out from under a running server yields a
  // corrupt copy, so require the old stack to be stopped first.
  const running = await containersUsingPath(
    services(ctx.env).map((s) => s.container),
    from,
  );
  const wantsData = opts.configOnly !== true;

  say.blank();
  console.log(`  ${color.brand(color.bold('Migrate'))}`);
  say.meta(`  from  ${from}`);
  say.meta(`  to    ${tildify(ctx.home)}`);
  say.blank();
  say.meta('  The source is only read — nothing there is changed or deleted.');
  say.blank();

  if (wantsData && running.length > 0) {
    throw new UserError(
      `These containers are still running from ${from}: ${running.join(', ')}`,
      'Stop them first so the data copy is consistent:\n' +
        `    cd ${from} && sudo docker compose down\n` +
        '  Or copy the configuration only: pubservices migrate --config-only',
    );
  }

  if (!(await confirm(ctx, wantsData ? 'Copy configuration and data?' : 'Copy configuration?'))) {
    say.meta('Cancelled.');
    return;
  }

  const copied: Copied[] = [];

  for (const entry of CONFIG_ENTRIES) {
    const source = join(from, entry);
    if (!existsSync(source)) continue;
    const target = join(ctx.home, entry);
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(source, target, { recursive: true, force: true });
    copied.push({ entry, from: source, to: target });
    say.ok(`copied ${entry}`);
  }

  if (wantsData) {
    const sourceData = join(from, 'data');
    if (existsSync(sourceData)) {
      say.step('Copying data directories...');
      // MySQL's files belong to uid 999 and are unreadable to the invoking user,
      // so the copy runs in a container that preserves ownership.
      const script = DATA_DIRS.map(
        (d) => `if [ -d /from/${d} ]; then mkdir -p /to/${d} && cp -a /from/${d}/. /to/${d}/; fi`,
      ).join('; ');
      const res = await inContainer(
        [
          { host: sourceData, at: '/from', readonly: true },
          { host: join(ctx.home, 'data'), at: '/to' },
        ],
        script,
      );
      if (res.code !== 0) {
        throw new UserError('Could not copy the data directories.', (res.stderr || res.stdout).trim());
      }
      for (const d of DATA_DIRS) {
        const target = join(ctx.home, 'data', d);
        if (existsSync(target) && readdirSync(target).length > 0) {
          copied.push({ entry: `data/${d}`, from: join(sourceData, d), to: target });
          say.ok(`copied data/${d}`);
        }
      }
    }
  }

  if (ctx.json) {
    emitJson({ from, to: ctx.home, copied: copied.map((c) => c.entry) });
    return;
  }

  say.blank();
  say.ok(`Migrated ${copied.length} item(s) into ${tildify(ctx.home)}`);
  say.blank();
  say.meta('  Next:');
  say.meta('    pubservices up --full          start the stack from its new home');
  say.meta('    pubservices doctor             confirm everything resolves');
  say.blank();
  say.meta('  local-dev-proxy reads the nginx paths from the container mounts,');
  say.meta('  so it follows the new location automatically once nginx restarts.');
  say.blank();
  say.meta('  The old installation is untouched. Remove it yourself when you are happy:');
  console.log(`    ${color.meta(`sudo rm -rf ${from}`)}`);
  say.blank();
}

/** Size of a directory tree, for reporting before a migration. */
export function treeSize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    try {
      if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
    } catch {
      // Unreadable container-owned files still count as "present"; size is cosmetic.
    }
  }
  return total;
}
