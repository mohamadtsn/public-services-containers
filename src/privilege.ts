import { accessSync, constants } from 'node:fs';
import { UserError, color, say } from './ui.js';

/**
 * v2 aims to need root for nothing: state lives in a user-owned home directory,
 * and container-owned files are edited through a throwaway container
 * (see `inContainer` in docker.ts) rather than `sudo rm`.
 *
 * This module is the escape hatch and the diagnostics for the one case left:
 * an npm prefix the user cannot write to.
 */

export const isRoot = (): boolean => typeof process.getuid === 'function' && process.getuid() === 0;

export function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses an operation that would need root, explaining why and what to do instead.
 * Nothing in v2 should reach this — if something does, that is a bug to fix by
 * moving the work into a container or into the user-owned home directory.
 */
export function refuseRoot(what: string, hint: string): never {
  throw new UserError(`${what} would require root.`, hint);
}

export function warnIfRoot(): void {
  if (!isRoot()) return;
  say.warn(
    `Running as root. Files created now will be root-owned; run ${color.bold('pubservices')} as your normal user.`,
  );
}
