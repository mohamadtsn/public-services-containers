import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Persisted in $PUBSERVICES_HOME/state.json. */
export interface State {
  /** Package version whose templates were last seeded into the home directory. */
  version: string;
  /** Static site name -> source directory it was last synced from. */
  staticSources: Record<string, string>;
}

const EMPTY: State = { version: '', staticSources: {} };

const file = (home: string) => join(home, 'state.json');

export function readState(home: string): State {
  try {
    const raw = JSON.parse(readFileSync(file(home), 'utf8')) as Partial<State>;
    return {
      version: typeof raw.version === 'string' ? raw.version : '',
      staticSources: raw.staticSources ?? {},
    };
  } catch {
    // Missing or corrupt state is not an error: it just means "seed everything".
    return { ...EMPTY, staticSources: {} };
  }
}

export function writeState(home: string, state: State): void {
  writeFileSync(file(home), `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(home: string, patch: Partial<State>): State {
  const next = { ...readState(home), ...patch };
  writeState(home, next);
  return next;
}
