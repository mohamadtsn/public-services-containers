import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { context } from '../src/context.js';
import { type Ctx } from '../src/context.js';
import { dockerVersion, purgeDataDirs, run } from '../src/docker.js';

/**
 * An isolated stack for integration tests.
 *
 * A real production stack runs on developer machines. Every identifier below is
 * deliberately distinct from the shipped defaults so the two can never meet:
 * different compose project, different network, different container names and
 * a port block far from the defaults. `assertIsolated()` re-checks this at
 * runtime, so a careless edit to the defaults fails the test instead of
 * touching live containers.
 */
export const PROJECT = 'psvc-it';
export const NETWORK = 'psvc-it-network';
export const PREFIX = 'psvc-it-';

/** Chosen from a free block; nothing in the default .env comes near 452xx. */
const PORTS = {
  MYSQL_PORT: '45306',
  REDIS_PORT: '45379',
  POSTGRES_PORT: '45532',
  NGINX_HTTP_PORT: '45080',
  NGINX_HTTPS_PORT: '45443',
  PMA_PORT: '45880',
  PGADMIN_PORT: '45881',
  MAILPIT_SMTP_PORT: '45025',
  MAILPIT_HTTP_PORT: '45825',
  MINIO_API_PORT: '45900',
  MINIO_CONSOLE_PORT: '45901',
} as const;

const CONTAINERS = {
  MYSQL_CONTAINER_NAME: `${PREFIX}mysql`,
  REDIS_CONTAINER_NAME: `${PREFIX}redis`,
  POSTGRES_CONTAINER_NAME: `${PREFIX}postgres`,
  NGINX_CONTAINER_NAME: `${PREFIX}nginx`,
  PMA_CONTAINER_NAME: `${PREFIX}pma`,
  PGADMIN_CONTAINER_NAME: `${PREFIX}pgadmin`,
  MAILPIT_CONTAINER_NAME: `${PREFIX}mailpit`,
  MINIO_CONTAINER_NAME: `${PREFIX}minio`,
} as const;

/** Names and ports that belong to a real installation and must never be used here. */
const LIVE = {
  containers: [
    'mysql-main',
    'redis-main',
    'postgres-main',
    'nginx-main',
    'phpmyadmin',
    'pgadmin',
    'mailpit',
    'minio',
  ],
  network: 'public-service-network',
  ports: [
    '43306',
    '46379',
    '45432',
    '80',
    '443',
    '18080',
    '18081',
    '1025',
    '8025',
    '9000',
    '9001',
  ],
};

export interface Sandbox {
  home: string;
  ctx: Ctx;
  /** compose invoked against this sandbox only */
  compose: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  destroy: () => Promise<void>;
}

export async function dockerReady(): Promise<boolean> {
  return (await dockerVersion()) !== null;
}

function assertIsolated(home: string): void {
  const path = resolve(home);
  if (!path.startsWith(resolve(tmpdir()))) {
    throw new Error(`Sandbox home escaped the temp directory: ${path}`);
  }
  if (NETWORK === LIVE.network) throw new Error('Sandbox network collides with the live network.');
  for (const name of Object.values(CONTAINERS)) {
    if (LIVE.containers.includes(name)) throw new Error(`Sandbox container collides: ${name}`);
    if (!name.startsWith(PREFIX)) throw new Error(`Sandbox container lacks the prefix: ${name}`);
  }
  for (const port of Object.values(PORTS)) {
    if (LIVE.ports.includes(port)) throw new Error(`Sandbox port collides with a live port: ${port}`);
  }
}

/** Removes leftovers from a previous interrupted run — scoped to the prefix. */
async function sweep(): Promise<void> {
  const listed = await run('docker', [
    'ps',
    '-aq',
    '--filter',
    `name=^/${PREFIX}`,
  ]);
  const ids = listed.stdout.split('\n').filter(Boolean);
  if (ids.length > 0) await run('docker', ['rm', '-f', ...ids]);
  await run('docker', ['network', 'rm', NETWORK]);
}

export async function createSandbox(): Promise<Sandbox> {
  const home = mkdtempSync(join(tmpdir(), 'pubservices-it-'));
  assertIsolated(home);
  await sweep();

  // Seed the layout, then overwrite .env with the isolated identifiers.
  context({ home });

  const env = [
    `COMPOSE_PROJECT_NAME=${PROJECT}`,
    `NETWORK_NAME=${NETWORK}`,
    ...Object.entries({ ...CONTAINERS, ...PORTS }).map(([k, v]) => `${k}=${v}`),
    'MYSQL_ROOT_PASSWORD=sandbox-root',
    'MYSQL_PASSWORD=sandbox',
    'PMA_BLOWFISH_SECRET=0123456789abcdef0123456789abcdef',
  ].join('\n');
  writeFileSync(join(home, '.env'), `${env}\n`);

  const ctx = context({ home, yes: true });

  const composeIn = (args: string[]) =>
    run('docker', ['compose', ...args], { cwd: home });

  const destroy = async (): Promise<void> => {
    // Re-assert before any destructive call: `down -v` deletes volumes.
    assertIsolated(home);
    await composeIn(['down', '-v', '--remove-orphans']);
    await sweep();
    // Containers write into data/ as their own uid, so the invoking user cannot
    // remove those files directly. Same reason `reset` uses this path.
    await purgeDataDirs(home, ['mysql', 'redis', 'postgres', 'minio']);
    rmSync(home, { recursive: true, force: true });
  };

  return { home, ctx, compose: composeIn, destroy };
}

/**
 * Polls until the container reports the wanted value, or gives up.
 *
 * `status` and `health` are reported separately on purpose: a stopped container
 * keeps its last health value, so asking "is it stopped?" must look at status.
 */
export async function waitFor(
  container: string,
  field: 'status' | 'health',
  wanted: string[],
  timeoutMs = 45_000,
): Promise<string> {
  const format =
    field === 'status'
      ? '{{.State.Status}}'
      : '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}';

  const deadline = Date.now() + timeoutMs;
  let last = 'missing';
  while (Date.now() < deadline) {
    const res = await run('docker', ['inspect', '--format', format, container]);
    last = res.stdout.trim() || 'missing';
    if (wanted.includes(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}
