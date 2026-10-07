import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Ctx, emitJson } from '../context.js';
import { dockerVersion, run } from '../docker.js';
import { LEGACY_INSTALL_DIR } from '../legacy.js';
import { isRoot, isWritable } from '../privilege.js';
import { color, pad, say, symbol, tildify, width } from '../ui.js';

export type Level = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  level: Level;
  detail: string;
  hint?: string;
}

const MARK: Record<Level, string> = {
  ok: color.ok(symbol.ok),
  warn: color.warn(symbol.warn),
  fail: color.err(symbol.fail),
};

async function checkDocker(): Promise<Check[]> {
  const out: Check[] = [];

  const cli = await run('docker', ['--version']).catch(() => null);
  if (!cli || cli.code !== 0) {
    out.push({
      name: 'docker',
      level: 'fail',
      detail: 'not installed',
      hint: 'Install Docker Engine or Docker Desktop, then re-run pubservices doctor.',
    });
    return out;
  }
  out.push({ name: 'docker', level: 'ok', detail: cli.stdout.trim() });

  const server = await dockerVersion();
  out.push(
    server
      ? { name: 'docker daemon', level: 'ok', detail: `server ${server}` }
      : {
          name: 'docker daemon',
          level: 'fail',
          detail: 'not reachable',
          hint: 'Start the daemon (systemctl --user start docker, or open Docker Desktop).',
        },
  );

  const compose = await run('docker', ['compose', 'version', '--short']).catch(() => null);
  out.push(
    compose && compose.code === 0
      ? { name: 'docker compose', level: 'ok', detail: `v${compose.stdout.trim().replace(/^v/, '')}` }
      : {
          name: 'docker compose',
          level: 'fail',
          detail: 'plugin missing',
          hint: 'Install the docker-compose-plugin package (Compose v1 is not supported).',
        },
  );

  return out;
}

function checkHome(ctx: Ctx): Check[] {
  const out: Check[] = [];

  out.push(
    isWritable(ctx.home)
      ? { name: 'home', level: 'ok', detail: tildify(ctx.home) }
      : {
          name: 'home',
          level: 'fail',
          detail: `${ctx.home} is not writable`,
          hint: 'Pick another location with PUBSERVICES_HOME, or fix the directory owner.',
        },
  );

  const envFile = join(ctx.home, '.env');
  out.push(
    existsSync(envFile)
      ? { name: '.env', level: 'ok', detail: tildify(envFile) }
      : { name: '.env', level: 'fail', detail: 'missing', hint: 'Run any command to re-seed it.' },
  );

  const secret = ctx.env['PMA_BLOWFISH_SECRET'] ?? '';
  if (secret.length !== 32) {
    out.push({
      name: 'pma secret',
      level: 'warn',
      detail: `PMA_BLOWFISH_SECRET is ${secret.length} chars, must be exactly 32`,
      hint: 'phpMyAdmin will not keep you logged in until this is fixed.',
    });
  } else if (secret.startsWith('change-this-to-a-32-char-string')) {
    out.push({
      name: 'pma secret',
      level: 'warn',
      detail: 'still the default value',
      hint: 'Change PMA_BLOWFISH_SECRET in .env to any other 32-character string.',
    });
  } else {
    out.push({ name: 'pma secret', level: 'ok', detail: '32 characters' });
  }

  return out;
}

/**
 * The one place root can still bite: a globally installed npm whose prefix the
 * user cannot write to forces `sudo npm i -g` for every install and update.
 */
async function checkNpmPrefix(): Promise<Check> {
  const res = await run('npm', ['config', 'get', 'prefix']).catch(() => null);
  if (!res || res.code !== 0) {
    return { name: 'npm prefix', level: 'warn', detail: 'could not determine' };
  }
  const prefix = res.stdout.trim();
  if (isWritable(prefix)) {
    return { name: 'npm prefix', level: 'ok', detail: `${prefix} (writable, no sudo needed)` };
  }
  return {
    name: 'npm prefix',
    level: 'warn',
    detail: `${prefix} is root-owned`,
    hint: 'Updates will need sudo. To avoid that: npm config set prefix ~/.npm-global && export PATH=~/.npm-global/bin:$PATH',
  };
}

function checkEcosystem(): Check[] {
  const out: Check[] = [];

  out.push(
    isRoot()
      ? {
          name: 'user',
          level: 'warn',
          detail: 'running as root',
          hint: 'Run as your normal user; nothing in pubservices needs root.',
        }
      : { name: 'user', level: 'ok', detail: 'not root' },
  );

  if (existsSync(LEGACY_INSTALL_DIR)) {
    out.push({
      name: 'legacy install',
      level: 'warn',
      detail: LEGACY_INSTALL_DIR,
      hint: 'A v1 installation is still in place. Run: pubservices migrate',
    });
  }

  if (existsSync('/usr/local/bin/devproxy')) {
    out.push({
      name: 'local-dev-proxy',
      level: 'ok',
      detail: 'detected — it resolves nginx paths from the container mounts',
    });
  }

  return out;
}

export async function doctorCommand(ctx: Ctx): Promise<void> {
  const checks: Check[] = [
    ...(await checkDocker()),
    ...checkHome(ctx),
    await checkNpmPrefix(),
    ...checkEcosystem(),
  ];

  if (ctx.json) {
    emitJson({ home: ctx.home, checks });
  } else {
    const nameWidth = checks.reduce((n, c) => Math.max(n, width(c.name)), 0);
    say.blank();
    console.log(`  ${color.brand(color.bold('Doctor'))}`);
    say.blank();
    for (const c of checks) {
      console.log(`  ${MARK[c.level]} ${color.meta(pad(c.name, nameWidth))}  ${c.detail}`);
      if (c.hint) console.log(`    ${color.meta(c.hint)}`);
    }
    say.blank();
  }

  if (checks.some((c) => c.level === 'fail')) process.exitCode = 1;
}
