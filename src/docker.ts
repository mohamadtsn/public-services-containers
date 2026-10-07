import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { UserError } from './ui.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  /** 'inherit' streams straight to the terminal (logs, builds); 'pipe' captures. */
  stdio?: 'inherit' | 'pipe';
  env?: NodeJS.ProcessEnv;
  /** Feed this file to the process on stdin (SQL restore). */
  stdinFile?: string;
  /** Stream stdout to this file instead of buffering it (SQL dumps can be huge). */
  stdoutFile?: string;
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { cwd, stdio = 'pipe', env, stdinFile, stdoutFile } = opts;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio:
        stdio === 'inherit' ? 'inherit' : [stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });

    let stdout = '';
    let stderr = '';
    let failed: Error | null = null;

    if (stdoutFile && child.stdout) {
      const sink = createWriteStream(stdoutFile);
      sink.on('error', (err) => (failed ??= err));
      child.stdout.pipe(sink);
    } else {
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    }

    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

    if (stdinFile && child.stdin) {
      const source = createReadStream(stdinFile);
      source.on('error', (err) => {
        failed ??= err;
        child.stdin?.end();
      });
      source.pipe(child.stdin);
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new UserError(`Command not found: ${cmd}`));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (failed) {
        reject(failed);
        return;
      }
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs a command and fails loudly on a non-zero exit. */
export async function runOrFail(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().split('\n').slice(-3).join('\n');
    throw new UserError(`${cmd} ${args[0] ?? ''} failed (exit ${res.code})`, detail || undefined);
  }
  return res;
}

export async function dockerVersion(): Promise<string | null> {
  try {
    const res = await run('docker', ['version', '--format', '{{.Server.Version}}']);
    return res.code === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}

export type ContainerStatus =
  | 'healthy'
  | 'unhealthy'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'missing';

/** Single `docker inspect` covering every container, so `status` costs one process. */
export async function inspectMany(names: string[]): Promise<Map<string, ContainerStatus>> {
  const out = new Map<string, ContainerStatus>(names.map((n) => [n, 'missing' as const]));
  if (names.length === 0) return out;

  const format = '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}';
  const res = await run('docker', ['inspect', '--format', format, ...names]);

  for (const line of res.stdout.split('\n')) {
    const [rawName, state, health] = line.trim().split(/\s+/);
    if (!rawName || !state) continue;
    const name = rawName.replace(/^\//, '');
    out.set(name, classify(state, health ?? 'none'));
  }
  return out;
}

/**
 * Containers whose bind mounts come from `prefix`. Used by `migrate` to refuse
 * copying a database out from under a running server.
 */
export async function containersUsingPath(
  names: string[],
  prefix: string,
): Promise<string[]> {
  if (names.length === 0) return [];
  const res = await run('docker', [
    'inspect',
    '--format',
    '{{.Name}}|{{.State.Running}}|{{range .Mounts}}{{.Source}};{{end}}',
    ...names,
  ]);

  const hits: string[] = [];
  for (const line of res.stdout.split('\n')) {
    const [rawName, running, mounts] = line.trim().split('|');
    if (!rawName || running !== 'true') continue;
    if ((mounts ?? '').split(';').some((m) => m && m.startsWith(prefix))) {
      hits.push(rawName.replace(/^\//, ''));
    }
  }
  return hits;
}

function classify(state: string, health: string): ContainerStatus {
  if (state !== 'running') return state === 'exited' || state === 'created' ? 'stopped' : 'missing';
  if (health === 'healthy') return 'healthy';
  if (health === 'unhealthy') return 'unhealthy';
  if (health === 'starting') return 'starting';
  return 'running';
}

export interface ComposeOptions extends RunOptions {
  /** Profiles to enable; omit for core services only. */
  profiles?: readonly string[];
}

/** `docker compose` invoked with cwd = the home directory, so it finds .env itself. */
export function compose(home: string, args: string[], opts: ComposeOptions = {}): Promise<RunResult> {
  const { profiles = [], ...rest } = opts;
  const flags = profiles.flatMap((p) => ['--profile', p]);
  return run('docker', ['compose', ...flags, ...args], { cwd: home, ...rest });
}

/**
 * Runs a shell snippet inside a throwaway Alpine container with `mounts` bound in.
 * This is how the CLI touches container-owned files (MySQL's uid 999, Redis's data)
 * without ever asking for sudo — the Docker daemon already has the privileges.
 */
export function inContainer(
  mounts: Array<{ host: string; at: string; readonly?: boolean }>,
  script: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const args = ['run', '--rm'];
  for (const m of mounts) args.push('-v', `${m.host}:${m.at}${m.readonly ? ':ro' : ''}`);
  args.push('alpine:3.20', 'sh', '-c', script);
  return run('docker', args, opts);
}

/**
 * Empties `<home>/data/<name>` directories. MySQL runs as uid 999 and Redis
 * writes as its own user, so the files they leave behind are not deletable by
 * the invoking user — this is the `sudo rm -rf data/mysql/*` that v1 needed.
 * Doing it from a container keeps the CLI free of root entirely.
 *
 * The directories themselves are kept; only their contents are removed.
 */
export async function purgeDataDirs(home: string, names: string[]): Promise<void> {
  const dataDir = join(home, 'data');

  // A wrong `home` here would delete real data, so refuse anything suspicious
  // rather than trusting the caller.
  if (!isAbsolute(home) || resolvePath(home) === '/' || names.length === 0) {
    throw new UserError(`Refusing to purge data for an unsafe home path: ${home}`);
  }
  if (names.some((n) => n.includes('/') || n.includes('..') || n === '')) {
    throw new UserError(`Refusing to purge a path outside data/: ${names.join(', ')}`);
  }

  const script = names.map((n) => `find /data/${n} -mindepth 1 -delete 2>/dev/null`).join('; ');
  const res = await inContainer([{ host: dataDir, at: '/data' }], `${script}; exit 0`);
  if (res.code !== 0) {
    throw new UserError('Could not clear the data directories.', (res.stderr || res.stdout).trim());
  }
}
