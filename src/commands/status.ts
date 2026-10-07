import { printDashboard } from '../dashboard.js';
import { type Ctx, emitJson } from '../context.js';
import { type ContainerStatus, dockerVersion, inspectMany } from '../docker.js';
import { services } from '../env.js';
import { packageVersion } from '../home.js';
import { say } from '../ui.js';

export async function statusCommand(ctx: Ctx): Promise<void> {
  if (ctx.json) {
    const list = services(ctx.env);
    const docker = await dockerVersion();
    const states = docker
      ? await inspectMany(list.map((s) => s.container))
      : new Map<string, ContainerStatus>();

    const rows = list.map((s) => ({
      ...s,
      status: states.get(s.container) ?? ('missing' as ContainerStatus),
    }));

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
  await printDashboard(ctx);
  say.blank();
}
