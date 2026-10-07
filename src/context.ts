import { type Env, loadEnv } from './env.js';
import { ensureHome } from './home.js';
import { warnIfRoot } from './privilege.js';

export interface GlobalOptions {
  home?: string;
  json?: boolean;
  yes?: boolean;
}

export interface Ctx {
  home: string;
  env: Env;
  json: boolean;
  /** Skip interactive confirmations (also implied when stdin is not a TTY). */
  yes: boolean;
  /** True on the run that created the home directory. */
  created: boolean;
}

/**
 * Every command starts here: bootstrap the home directory, then read .env.
 * Bootstrapping is idempotent and never touches data/, so it is safe to run
 * ahead of read-only commands too.
 */
export function context(opts: GlobalOptions = {}): Ctx {
  warnIfRoot();
  const { home, created } = ensureHome(opts.home);
  return {
    home,
    env: loadEnv(home),
    json: opts.json === true,
    yes: opts.yes === true || !process.stdin.isTTY,
    created,
  };
}

/** Prints JSON on one line for piping into jq. */
export function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
