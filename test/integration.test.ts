import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downCommand, logsCommand, restartCommand, upCommand } from '../src/commands/lifecycle.js';
import { context } from '../src/context.js';
import { inspectMany } from '../src/docker.js';
import { PREFIX, type Sandbox, createSandbox, dockerReady, waitFor } from './sandbox.js';

/**
 * Drives the real lifecycle commands against a throwaway stack.
 *
 * Only Redis is started: it is the lightest service with a healthcheck, its
 * image is already present wherever the stack has run, and it needs no
 * credentials. MySQL would add ~30s per run for no extra coverage of the CLI.
 */
const ready = await dockerReady();
const suite = ready ? describe : describe.skip;

suite('lifecycle against a sandbox stack', () => {
  let sandbox: Sandbox;
  let container: string;

  beforeAll(async () => {
    sandbox = await createSandbox();
    container = sandbox.ctx.env.REDIS_CONTAINER_NAME;
    expect(container.startsWith(PREFIX)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await sandbox?.destroy();
  }, 60_000);

  const quiet = () => context({ home: sandbox.home, yes: true, json: true });

  it('starts a single service and reports it healthy', async () => {
    await upCommand(quiet(), 'redis', {});
    expect(await waitFor(container, 'health', ['healthy', 'running'])).toMatch(/healthy|running/);

    const states = await inspectMany([container]);
    expect(['healthy', 'running']).toContain(states.get(container));
  }, 90_000);

  it('reads logs without following', async () => {
    await expect(logsCommand(quiet(), 'redis', { follow: false, tail: '5' })).resolves.not.toThrow();
  }, 30_000);

  it('restarts a running service', async () => {
    await restartCommand(quiet(), 'redis', {});
    expect(await waitFor(container, 'health', ['healthy', 'running'])).toMatch(/healthy|running/);
  }, 90_000);

  it('stops a service and leaves it stopped', async () => {
    await downCommand(quiet(), 'redis', {});
    // A stopped container keeps its last health value, so assert on status.
    expect(await waitFor(container, 'status', ['exited'], 20_000)).toBe('exited');
  }, 60_000);

  it('never creates a container outside its own prefix', async () => {
    const { stdout } = await sandbox.compose(['ps', '--all', '--format', '{{.Name}}']);
    const names = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith(PREFIX)).toBe(true);
  }, 30_000);
});
