import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployMode, FrameworkType } from './detect.js';

/** Rich metadata for a deployed site (v2 format). */
export interface StaticSiteInfo {
  /** Project root (or build output dir for legacy / plain-static entries). */
  source: string;
  /** Detected framework at last add / update. */
  type: FrameworkType;
  /** Whether the site was deployed as static files or an SSR container. */
  deployMode: DeployMode;
  /** Framework-specific output mode, e.g. 'export', 'standalone', 'generate'. */
  outputMode?: string;
  /** Auto-assigned host port for SSR containers. */
  port?: number;
}

/** Persisted in $PUBSERVICES_HOME/state.json. */
export interface State {
  /** Package version whose templates were last seeded into the home directory. */
  version: string;
  /** Static site name -> source directory it was last synced from (legacy v1/v2-early). */
  staticSources: Record<string, string>;
  /** Rich per-site metadata (v2). Takes precedence over staticSources when present. */
  staticSites: Record<string, StaticSiteInfo>;
  /** Next available host port for SSR app containers. */
  nextAppPort: number;
}

/** First SSR app port — well outside the range used by the core services. */
const DEFAULT_APP_PORT = 48001;

const EMPTY: State = { version: '', staticSources: {}, staticSites: {}, nextAppPort: DEFAULT_APP_PORT };

const file = (home: string) => join(home, 'state.json');

export function readState(home: string): State {
  try {
    const raw = JSON.parse(readFileSync(file(home), 'utf8')) as Partial<State>;
    return {
      version: typeof raw.version === 'string' ? raw.version : '',
      staticSources: raw.staticSources ?? {},
      staticSites: raw.staticSites ?? {},
      nextAppPort: typeof raw.nextAppPort === 'number' ? raw.nextAppPort : DEFAULT_APP_PORT,
    };
  } catch {
    // Missing or corrupt state is not an error: it just means "seed everything".
    return { ...EMPTY, staticSources: {}, staticSites: {} };
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
