import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isCancel, select } from '@clack/prompts';
import type { Ctx } from '../context.js';
import { inspectMany, run } from '../docker.js';
import { services } from '../env.js';
import { UserError, color, say, tildify } from '../ui.js';

/** Opens the home .env in $EDITOR (or $VISUAL, or nano). */
export async function editCommand(ctx: Ctx): Promise<void> {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  const file = join(ctx.home, '.env');
  const res = await run(editor, [file], { stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`${editor} exited with ${res.code}.`);
  say.ok(`Saved ${file}`);
  say.meta('  Restart affected services for changes to take effect: pubservices restart');
}

export interface ServiceConfigFile {
  label: string;
  path: string;
  hint?: string;
}

export function serviceConfigFiles(ctx: Ctx, serviceKey: string): ServiceConfigFile[] {
  const envFile = join(ctx.home, '.env');
  const files: ServiceConfigFile[] = [];

  switch (serviceKey) {
    case 'mysql': {
      const customCnf = join(ctx.home, 'mysql/conf.d/custom.cnf');
      if (existsSync(customCnf)) {
        files.push({ label: 'MySQL custom config (custom.cnf)', path: customCnf, hint: 'my.cnf overrides' });
      }
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'MYSQL_DATABASE, passwords, ports' });
      break;
    }
    case 'nginx': {
      const nginxConf = join(ctx.home, 'nginx/settings/nginx.conf');
      const defaultConf = join(ctx.home, 'nginx/site-enabled/default.conf');
      if (existsSync(nginxConf)) {
        files.push({ label: 'Nginx main config (nginx.conf)', path: nginxConf, hint: 'main nginx configuration' });
      }
      if (existsSync(defaultConf)) {
        files.push({ label: 'Default site vhost (default.conf)', path: defaultConf, hint: 'HTTP/HTTPS server block' });
      }
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'ports and SSL settings' });
      break;
    }
    case 'postgres': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'POSTGRES_DB, user, password, port' });
      break;
    }
    case 'redis': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'REDIS_PORT' });
      break;
    }
    case 'phpmyadmin': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'PMA_PORT, PMA_BLOWFISH_SECRET' });
      break;
    }
    case 'pgadmin': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'PGADMIN_PORT, default email & password' });
      break;
    }
    case 'mailpit': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'MAILPIT_SMTP_PORT, MAILPIT_HTTP_PORT' });
      break;
    }
    case 'minio': {
      files.push({ label: 'Environment variables (.env)', path: envFile, hint: 'MINIO_API_PORT, credentials' });
      break;
    }
    default: {
      files.push({ label: 'Environment variables (.env)', path: envFile });
    }
  }
  return files;
}

/** Opens service-specific config in $EDITOR. */
export async function editServiceConfig(ctx: Ctx, serviceKey: string, targetPath?: string): Promise<void> {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  let fileToEdit = targetPath;

  if (!fileToEdit) {
    const configs = serviceConfigFiles(ctx, serviceKey);
    if (configs.length === 1) {
      fileToEdit = configs[0]!.path;
    } else {
      const choice = await select({
        message: `Select configuration file for ${serviceKey}:`,
        options: [
          ...configs.map((c) => ({ value: c.path, label: c.label, hint: c.hint })),
          { value: 'back', label: '← Back', hint: '' },
        ],
      });
      if (isCancel(choice) || choice === 'back') return;
      fileToEdit = choice as string;
    }
  }

  say.step(`Opening ${tildify(fileToEdit)} in ${editor}...`);
  const res = await run(editor, [fileToEdit], { stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`${editor} exited with ${res.code}.`);
  say.ok(`Saved ${tildify(fileToEdit)}`);
  say.meta(`  Restart ${serviceKey} for changes to take effect: pubservices restart ${serviceKey}`);
}

/** Opens an interactive shell in a container (bash, falling back to sh). */
export async function execShellCommand(ctx: Ctx, serviceKey: string): Promise<boolean> {
  const svc = services(ctx.env).find((s) => s.key === serviceKey);
  const container = svc ? svc.container : serviceKey;

  const state = (await inspectMany([container])).get(container);
  if (state !== 'healthy' && state !== 'running') {
    throw new UserError(
      `Container '${container}' is not running (${state ?? 'stopped'}).`,
      `Start it first: pubservices up ${serviceKey}`,
    );
  }

  say.step(`Connecting to ${container}... (type 'exit' or Ctrl+D to disconnect)`);
  say.blank();

  const checkBash = await run('docker', ['exec', container, 'which', 'bash']).catch(() => null);
  const shell = checkBash && checkBash.code === 0 ? 'bash' : 'sh';

  await run('docker', ['exec', '-it', container, shell], { stdio: 'inherit' });
  say.blank();
  say.ok(`Disconnected from ${container}.`);
  return true;
}

/** Runs an arbitrary command with the home directory as the working directory. */
export async function runCommand(ctx: Ctx, argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd) {
    throw new UserError('No command specified.', 'Example: pubservices run docker compose ps');
  }
  say.meta(`${color.meta(ctx.home)} $ ${argv.join(' ')}`);
  const res = await run(cmd, args, { cwd: ctx.home, stdio: 'inherit' });
  if (res.code !== 0) process.exitCode = res.code;
}
