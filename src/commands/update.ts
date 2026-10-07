import type { Ctx } from '../context.js';
import { run } from '../docker.js';
import { isWritable } from '../privilege.js';
import { packageVersion } from '../home.js';
import { confirm } from '../prompt.js';
import { UserError, color, say } from '../ui.js';

const PACKAGE = 'pubservices';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`;

/** Compares dotted numeric versions; pre-release suffixes sort before the release. */
export function isNewer(candidate: string, current: string): boolean {
  const split = (v: string): [number[], string] => {
    const [core = '', pre = ''] = v.replace(/^v/, '').split('-', 2);
    return [core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre];
  };
  const [a, aPre] = split(candidate);
  const [b, bPre] = split(current);

  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (aPre === bPre) return false;
  if (aPre === '') return true; // 2.0.0 beats 2.0.0-alpha.1
  if (bPre === '') return false;
  return aPre > bPre;
}

async function latestVersion(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(REGISTRY, { headers: { accept: 'application/json' } });
  } catch {
    throw new UserError('Could not reach the npm registry.', 'Check your internet connection.');
  }
  if (!response.ok) {
    throw new UserError(`npm registry returned ${response.status}.`);
  }
  const body = (await response.json()) as { version?: string };
  if (!body.version) throw new UserError('The npm registry response had no version field.');
  return body.version;
}

/**
 * v1 updated by piping a shell installer into `sudo bash`. v2 is an npm package,
 * so updating is `npm i -g` — and whether that needs sudo is a property of the
 * user's npm prefix, which is reported rather than assumed.
 */
export async function updateCommand(ctx: Ctx): Promise<void> {
  const current = packageVersion();

  say.step('Checking npm for a newer version...');
  const latest = await latestVersion();

  if (!isNewer(latest, current)) {
    say.ok(`Already up to date (v${current}).`);
    return;
  }

  say.blank();
  say.meta(`  installed  v${current}`);
  say.meta(`  available  v${latest}`);
  say.blank();

  if (!(await confirm(ctx, `Update to v${latest}?`, true))) {
    say.meta('Update cancelled.');
    return;
  }

  const prefixResult = await run('npm', ['config', 'get', 'prefix']);
  const prefix = prefixResult.stdout.trim();
  if (prefix && !isWritable(prefix)) {
    throw new UserError(
      `Your npm prefix (${prefix}) is not writable, so the update needs elevated rights.`,
      `Run it yourself:\n    sudo npm install -g ${PACKAGE}@latest\n` +
        `  Or stop needing sudo for npm:\n    npm config set prefix ~/.npm-global`,
    );
  }

  const res = await run('npm', ['install', '-g', `${PACKAGE}@latest`], { stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`npm install exited ${res.code}.`);

  say.blank();
  say.ok(`Updated to v${latest}.`);
  say.meta(`  Your data and configuration in ${color.bold(ctx.home)} are untouched.`);
  say.blank();
}
