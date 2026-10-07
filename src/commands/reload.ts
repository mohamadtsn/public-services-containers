import type { Ctx } from '../context.js';
import { inspectMany, run } from '../docker.js';
import { UserError, say } from '../ui.js';

/**
 * Reloads Nginx after local-dev-proxy (or a hand-edited vhost) changed
 * site-enabled/. The config is tested first: a failed test must not take a
 * working proxy down.
 */
export async function reloadProxyCommand(ctx: Ctx): Promise<void> {
  const name = ctx.env.NGINX_CONTAINER_NAME;
  const state = (await inspectMany([name])).get(name);

  if (!state || state === 'missing') {
    throw new UserError(
      `Nginx container '${name}' is not running.`,
      'Start it with: pubservices up --proxy',
    );
  }

  say.step('Testing Nginx configuration...');
  const test = await run('docker', ['exec', name, 'nginx', '-t'], { stdio: 'inherit' });
  if (test.code !== 0) {
    throw new UserError('Nginx configuration test failed — not reloading.');
  }

  const reload = await run('docker', ['exec', name, 'nginx', '-s', 'reload']);
  if (reload.code !== 0) {
    throw new UserError('Nginx reload failed.', (reload.stderr || reload.stdout).trim());
  }

  say.ok('Nginx reloaded.');
}
