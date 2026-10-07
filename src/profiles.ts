import { ALL_PROFILES } from './env.js';
import { UserError } from './ui.js';

export interface ProfileFlags {
  proxy?: boolean;
  pma?: boolean;
  mail?: boolean;
  storage?: boolean;
  postgres?: boolean;
  pgadmin?: boolean;
  full?: boolean;
}

const FLAG_TO_PROFILE: Array<[keyof ProfileFlags, string]> = [
  ['proxy', 'proxy'],
  ['pma', 'pma'],
  ['mail', 'mail'],
  ['storage', 'storage'],
  ['postgres', 'postgres'],
  ['pgadmin', 'pgadmin'],
];

/**
 * `up` starts core services (MySQL + Redis) unless profiles are requested —
 * matching `make up` / `make up-proxy` / `make up-full`.
 */
export function profilesForUp(flags: ProfileFlags): string[] {
  if (flags.full) return [...ALL_PROFILES];
  return FLAG_TO_PROFILE.filter(([flag]) => flags[flag] === true).map(([, profile]) => profile);
}

/**
 * `down`, `restart`, `logs` and `build` act on everything by default: stopping
 * "all services" must not leave the optional ones running.
 */
export function profilesForAll(flags: ProfileFlags): string[] {
  const selected = profilesForUp(flags);
  return selected.length > 0 ? selected : [...ALL_PROFILES];
}

/** Guards against typos like `pubservices logs mysqll` reaching docker. */
export function assertKnownService(service: string, keys: string[]): void {
  if (keys.includes(service)) return;
  throw new UserError(`Unknown service: ${service}`, `Known services: ${keys.join(', ')}`);
}
