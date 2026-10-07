import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from './state.js';
import { UserError } from './ui.js';

/** Directories always present in the home; `data/` is created but never re-seeded. */
const DIRS = [
  'data/mysql',
  'data/redis',
  'data/minio',
  'nginx/site-enabled',
  'nginx/certificates',
  'nginx/static',
  'mysql/conf.d',
  'backups',
];

/** Template paths copied from the package into the home on install and upgrade. */
const SEEDED = ['docker-compose.yml', 'nginx/Dockerfile', 'nginx/settings', 'mysql/conf.d'];

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new UserError('Could not locate the pubservices package root.');
}

export const packageRoot = findPackageRoot;

export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findPackageRoot(), 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}

/**
 * Where the shipped stack files live. Published packages carry `templates/`;
 * a dev checkout still has them at the repo root, so fall back to that.
 */
export function templatesDir(): string {
  const root = findPackageRoot();
  const templates = join(root, 'templates');
  return existsSync(templates) ? templates : root;
}

/** All mutable state lives here — user-owned, so no command needs root. */
export function resolveHome(override?: string): string {
  const raw = override ?? process.env['PUBSERVICES_HOME'] ?? join(homedir(), '.pubservices');
  return resolve(raw.replace(/^~(?=$|\/)/, homedir()));
}

export interface EnsureResult {
  home: string;
  /** True on the very first run, when the home directory did not exist. */
  created: boolean;
  /** True when templates were (re)copied because the package version changed. */
  seeded: boolean;
}

/**
 * Idempotent bootstrap, run before every command. Replaces what install.sh used
 * to do with root: create the layout, seed .env, and refresh stack templates
 * after an upgrade. Never writes inside data/ — those files belong to the
 * containers (MySQL runs as uid 999) and touching them corrupts startup.
 */
export function ensureHome(override?: string): EnsureResult {
  const home = resolveHome(override);
  const created = !existsSync(home);
  const templates = templatesDir();
  const version = packageVersion();

  for (const dir of DIRS) mkdirSync(join(home, dir), { recursive: true });

  const envFile = join(home, '.env');
  if (!existsSync(envFile)) {
    const example = join(templates, '.env.example');
    if (!existsSync(example)) throw new UserError(`Missing template: ${example}`);
    cpSync(example, envFile);
  }

  const state = readState(home);
  const seeded = state.version !== version;
  if (seeded) {
    for (const entry of SEEDED) {
      const from = join(templates, entry);
      if (existsSync(from)) cpSync(from, join(home, entry), { recursive: true, force: true });
    }
    // site-enabled holds user/devproxy-generated vhosts: seed the default only once.
    const defaultConf = join(templates, 'nginx/site-enabled/default.conf');
    const target = join(home, 'nginx/site-enabled/default.conf');
    if (created && existsSync(defaultConf)) cpSync(defaultConf, target);

    writeState(home, { ...state, version });
  }

  return { home, created, seeded };
}
