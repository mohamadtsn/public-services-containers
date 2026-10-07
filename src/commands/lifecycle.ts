import type { Ctx } from '../context.js';
import { compose } from '../docker.js';
import { services } from '../env.js';
import { type ProfileFlags, assertKnownService, profilesForAll, profilesForUp } from '../profiles.js';
import { confirm } from '../prompt.js';
import { UserError, color, say } from '../ui.js';
import { statusCommand } from './status.js';

function serviceKeys(ctx: Ctx): string[] {
  return services(ctx.env).map((s) => s.key);
}

/** Runs a compose subcommand, streaming docker's own progress output. */
async function composeOrFail(
  ctx: Ctx,
  args: string[],
  profiles: string[],
  what: string,
): Promise<void> {
  const res = await compose(ctx.home, args, { profiles, stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`${what} failed (docker compose exited ${res.code}).`);
}

export interface UpOptions extends ProfileFlags {
  build?: boolean;
}

export async function upCommand(ctx: Ctx, service: string | undefined, opts: UpOptions): Promise<void> {
  if (service) assertKnownService(service, serviceKeys(ctx));

  const profiles = service ? [] : profilesForUp(opts);
  const args = ['up', '-d'];
  if (opts.build) args.push('--build');
  if (service) args.push(service);

  await composeOrFail(ctx, args, profiles, 'Start');
  if (!ctx.json) await statusCommand(ctx);
}

export async function downCommand(
  ctx: Ctx,
  service: string | undefined,
  opts: ProfileFlags,
): Promise<void> {
  if (service) {
    assertKnownService(service, serviceKeys(ctx));
    if (!(await confirm(ctx, `Stop ${color.bold(service)}?`))) {
      say.meta('Cancelled.');
      return;
    }
    await composeOrFail(ctx, ['stop', service], [], 'Stop');
    say.ok(`Stopped ${service}.`);
    return;
  }

  if (!(await confirm(ctx, 'Stop all services? (data is preserved)'))) {
    say.meta('Cancelled.');
    return;
  }
  // `down` removes containers but never volumes or bind-mounted data.
  await composeOrFail(ctx, ['down'], profilesForAll(opts), 'Stop');
  say.ok('All services stopped.');
}

export async function restartCommand(
  ctx: Ctx,
  service: string | undefined,
  opts: ProfileFlags,
): Promise<void> {
  if (service) assertKnownService(service, serviceKeys(ctx));
  const args = service ? ['restart', service] : ['restart'];
  await composeOrFail(ctx, args, service ? [] : profilesForAll(opts), 'Restart');
  if (!ctx.json) await statusCommand(ctx);
}

export interface LogsOptions extends ProfileFlags {
  tail?: string;
  follow?: boolean;
}

export async function logsCommand(
  ctx: Ctx,
  service: string | undefined,
  opts: LogsOptions,
): Promise<void> {
  if (service) assertKnownService(service, serviceKeys(ctx));

  const args = ['logs', '--tail', opts.tail ?? '100'];
  if (opts.follow !== false) args.push('-f');
  if (service) args.push(service);

  await composeOrFail(ctx, args, service ? [] : profilesForAll(opts), 'Logs');
}

export interface BuildOptions extends ProfileFlags {
  cache?: boolean;
}

export async function buildCommand(
  ctx: Ctx,
  service: string | undefined,
  opts: BuildOptions,
): Promise<void> {
  if (service) assertKnownService(service, serviceKeys(ctx));

  const args = ['build'];
  if (opts.cache === false) args.push('--no-cache');
  if (service) args.push(service);

  await composeOrFail(ctx, args, service ? [] : profilesForAll(opts), 'Build');
  say.ok('Images rebuilt.');
}
