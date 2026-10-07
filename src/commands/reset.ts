import type { Ctx } from '../context.js';
import { compose, purgeDataDirs } from '../docker.js';
import { ALL_PROFILES } from '../env.js';
import { confirmPhrase } from '../prompt.js';
import { UserError, color, say } from '../ui.js';

export interface ResetOptions {
  /** Also delete the .env file and every generated config, leaving a clean home. */
  purge?: boolean;
}

/**
 * Stops the stack and deletes all MySQL, Redis and MinIO data.
 *
 * The data files belong to the container users (MySQL runs as uid 999), which
 * is why v1 needed `sudo rm -rf data/mysql/*`. Here the deletion happens inside
 * a throwaway container, so the command needs no privileges at all.
 */
export async function resetCommand(ctx: Ctx, opts: ResetOptions = {}): Promise<void> {
  say.blank();
  console.log(`  ${color.err(color.bold('This permanently deletes all MySQL, Redis, PostgreSQL and MinIO data.'))}`);
  say.meta(`  home  ${ctx.home}`);
  say.meta('  Backups in backups/ are kept.');
  say.blank();

  if (!(await confirmPhrase(ctx, "Type 'yes' to confirm", 'yes'))) {
    say.meta('Reset cancelled.');
    return;
  }

  say.step('Stopping services and removing volumes...');
  const down = await compose(ctx.home, ['down', '-v'], {
    profiles: ALL_PROFILES,
    stdio: 'inherit',
  });
  if (down.code !== 0) {
    throw new UserError(`Could not stop the stack (docker compose exited ${down.code}).`);
  }

  say.step('Clearing data directories...');
  await purgeDataDirs(ctx.home, ['mysql', 'redis', 'postgres', 'minio']);

  if (opts.purge) {
    const { rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const entry of ['.env', 'docker-compose.override.yml', 'state.json']) {
      rmSync(join(ctx.home, entry), { force: true });
    }
    say.ok('Configuration removed — the next command will re-seed a fresh home.');
  }

  say.blank();
  say.ok('All data removed.');
  say.blank();
}
