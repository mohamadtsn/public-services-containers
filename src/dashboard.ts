import { listBackups } from './commands/backup.js';
import type { Ctx } from './context.js';
import { composeVersion, dockerVersion, inspectDetails } from './docker.js';
import { services } from './env.js';
import { packageVersion } from './home.js';
import { readState } from './state.js';
import { type DashboardData, renderDashboard } from './ui.js';

/**
 * Gathers live Docker inspection, storage metrics, and framework deployment states
 * to feed the aesthetic CLI dashboard.
 */
export async function getDashboardData(ctx: Ctx): Promise<DashboardData> {
  const list = services(ctx.env);
  const docker = await dockerVersion();
  const compose = docker ? await composeVersion() : null;
  const details = docker
    ? await inspectDetails(list.map((s) => s.container))
    : new Map();

  const backups = listBackups(ctx.home);
  const backupsCount = backups.length;
  const backupsBytes = backups.reduce((sum, b) => sum + b.size, 0);
  const backupsSize =
    backupsBytes > 0 ? `${(backupsBytes / 1_048_576).toFixed(1)} MB` : '0 MB';

  const state = readState(ctx.home);
  const appsCount =
    Object.keys(state.staticSites ?? {}).length ||
    Object.keys(state.staticSources ?? {}).length;

  const rows = list.map((s) => {
    const d = details.get(s.container);
    return {
      key: s.key,
      container: s.container,
      label: s.label,
      status: d?.status ?? 'missing',
      uptime: d?.uptime ?? '—',
      address: s.address,
      ip: d?.ip ?? '—',
    };
  });

  return {
    version: packageVersion(),
    home: ctx.home,
    docker,
    compose,
    network: ctx.env.NETWORK_NAME || 'public-service-network',
    backupsCount,
    backupsSize,
    appsCount,
    updatedAt: new Date().toLocaleTimeString(),
    services: rows,
  };
}

/** Fetches fresh data and prints the styled dashboard to stdout. */
export async function printDashboard(ctx: Ctx): Promise<void> {
  const data = await getDashboardData(ctx);
  console.log(renderDashboard(data));
}
