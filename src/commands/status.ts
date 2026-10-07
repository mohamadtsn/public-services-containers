import { type Ctx, emitJson } from '../context.js';
import { type ContainerStatus, dockerVersion, inspectMany } from '../docker.js';
import { services } from '../env.js';
import { packageVersion } from '../home.js';
import { box, color, say, symbol, tildify } from '../ui.js';

const LABEL: Record<ContainerStatus, string> = {
  healthy: color.ok(`${symbol.on} healthy`),
  running: color.ok(`${symbol.on} running`),
  starting: color.warn(`${symbol.on} starting`),
  unhealthy: color.err(`${symbol.on} unhealthy`),
  stopped: color.warn(`${symbol.off} stopped`),
  missing: color.meta(`${symbol.off} not found`),
};

export async function statusCommand(ctx: Ctx): Promise<void> {
  const list = services(ctx.env);
  const docker = await dockerVersion();
  const states = docker
    ? await inspectMany(list.map((s) => s.container))
    : new Map<string, ContainerStatus>();

  const rows = list.map((s) => ({
    ...s,
    status: states.get(s.container) ?? ('missing' as ContainerStatus),
  }));

  if (ctx.json) {
    emitJson({
      version: packageVersion(),
      home: ctx.home,
      docker,
      services: rows.map(({ key, label, container, profile, address, status }) => ({
        key,
        label,
        container,
        profile,
        address,
        status,
      })),
    });
    return;
  }

  say.blank();
  console.log(
    box({
      title: 'Public Services',
      tag: `v${packageVersion()}`,
      rows: rows.map((s) => [s.label, LABEL[s.status], s.address]),
      footer: [`home  ${tildify(ctx.home)}`, docker ? `docker  ${docker}` : 'docker  unavailable'],
    }),
  );
  say.blank();

  if (!docker) {
    say.warn('Docker daemon is not reachable — service states are unknown.');
    say.blank();
  }
}
