import { Box, Text, render, useApp, useInput } from 'ink';
import * as readline from 'node:readline';
import { useCallback, useEffect, useState } from 'react';
import { backupCommand, listBackups } from './commands/backup.js';
import { type Check, runDoctorChecks } from './commands/doctor.js';
import {
  buildCommand,
  downCommand,
  logsCommand,
  restartCommand,
  upCommand,
} from './commands/lifecycle.js';
import { reloadProxyCommand } from './commands/reload.js';
import { resetCommand } from './commands/reset.js';
import { restoreCommand } from './commands/restore.js';
import {
  editCommand,
  editServiceConfig,
  execShellCommand,
  serviceConfigFiles,
} from './commands/shell.js';
import {
  getSiteSummaries,
  staticAdd,
  staticMount,
  staticRemove,
  staticUnmount,
  staticUpdate,
} from './commands/static.js';
import type { Ctx } from './context.js';
import { getDashboardData } from './dashboard.js';
import { type ContainerStatus, compose, inspectMany } from './docker.js';
import type { ServiceInfo } from './env.js';
import { allServices as getAllServices } from './custom.js';
import { packageVersion } from './home.js';
import { profilesForUp } from './profiles.js';
import {
  DASHBOARD_BOX_WIDTH,
  type DashboardData,
  UserError,
  clearScreen,
  color,
  renderDashboard,
  say,
  tildify,
} from './ui.js';

const REFRESH_MS = 1000;

export const TONE: Record<ContainerStatus, string> = {
  healthy: 'green',
  running: 'green',
  starting: 'yellow',
  unhealthy: 'red',
  stopped: 'yellow',
  missing: 'gray',
};

export const DOT: Record<ContainerStatus, string> = {
  healthy: '●',
  running: '●',
  starting: '●',
  unhealthy: '●',
  stopped: '○',
  missing: '○',
};

type Pending = { key: string; label: string; run: () => Promise<void> } | null;

interface RowProps {
  service: ServiceInfo;
  status: ContainerStatus | null;
  selected: boolean;
  labelWidth: number;
  statusWidth: number;
}

function Row({ service, status, selected, labelWidth, statusWidth }: RowProps) {
  const cell = status === null ? '  … checking' : `  ${DOT[status]} ${status}`;
  return (
    <Text wrap="truncate">
      <Text color={selected ? 'cyan' : undefined}>{selected ? '❯ ' : '  '}</Text>
      <Text bold={selected}>{service.label.padEnd(labelWidth)}</Text>
      <Text color={status === null ? 'gray' : TONE[status]}>{cell.padEnd(statusWidth + 4)}</Text>
      <Text dimColor>{service.address}</Text>
    </Text>
  );
}

function Dashboard({ ctx }: { ctx: Ctx }) {
  const { exit } = useApp();
  const list = getAllServices(ctx.env, ctx.home);

  const [states, setStates] = useState<Map<string, ContainerStatus> | null>(null);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStates(await inspectMany(list.map((s) => s.container)));
    } catch {
      // transient docker error
    }
  }, [list]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(
    async (label: string, args: string[], profiles: string[] = []) => {
      setBusy(label);
      setError(null);
      const res = await compose(ctx.home, args, { profiles });
      if (res.code !== 0) {
        setError((res.stderr || res.stdout).trim().split('\n').slice(-1)[0] ?? 'command failed');
      }
      setBusy(null);
      await refresh();
    },
    [ctx.home, refresh],
  );

  useInput((input, key) => {
    if (busy) return;

    if (pending) {
      if (input === 'y' || input === 'Y') {
        const job = pending;
        setPending(null);
        void job.run();
      } else {
        setPending(null);
      }
      return;
    }

    const current = list[cursor];

    if (key.upArrow || input === 'k') setCursor((c) => (c - 1 + list.length) % list.length);
    else if (key.downArrow || input === 'j') setCursor((c) => (c + 1) % list.length);
    else if (input === 'q' || key.escape) exit();
    else if (input === 'R') void refresh();
    else if (input === 'a') void act('starting core', ['up', '-d']);
    else if (input === 'f') void act('starting everything', ['up', '-d'], profilesForUp({ full: true }));
    else if (current && input === 's') void act(`starting ${current.key}`, ['up', '-d', current.key]);
    else if (current && input === 'r') void act(`restarting ${current.key}`, ['restart', current.key]);
    else if (current && input === 'x') {
      setPending({
        key: current.key,
        label: `Stop ${current.label}?`,
        run: () => act(`stopping ${current.key}`, ['stop', current.key]),
      });
    }
  });

  const labelWidth = Math.max(...list.map((s) => s.label.length));
  const statusWidth = Math.max(...Object.keys(TONE).map((s) => s.length));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan" bold wrap="truncate">
          Public Services
        </Text>
        <Text dimColor wrap="truncate-start">{`  v${packageVersion()}  ${tildify(ctx.home)}`}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {list.map((service, index) => (
          <Row
            key={service.key}
            service={service}
            status={states ? (states.get(service.container) ?? 'missing') : null}
            selected={index === cursor}
            labelWidth={labelWidth}
            statusWidth={statusWidth}
          />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Text color="yellow">{`  … ${busy}`}</Text>
        ) : pending ? (
          <Text color="yellow">{`  ${pending.label} [y/N]`}</Text>
        ) : error ? (
          <Text color="red">{`  ✗ ${error}`}</Text>
        ) : (
          <Text dimColor wrap="truncate">
            {'  ↑↓ select   s start   x stop   r restart   a core   f all   R refresh   q quit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export async function runDash(ctx: Ctx): Promise<void> {
  const app = render(<Dashboard ctx={ctx} />);
  await app.waitUntilExit();
}

/* ------------------------------------------------------------------ */
/*  Unified Centered Live TUI Navigation System                       */
/* ------------------------------------------------------------------ */

export type ScreenState =
  | { type: 'root' }
  | { type: 'services' }
  | { type: 'service_list' }
  | { type: 'service_detail'; serviceKey: string }
  | { type: 'service_configs'; serviceKey: string }
  | { type: 'logs_service_select' }
  | { type: 'monitor' }
  | { type: 'connection_info' }
  | { type: 'doctor_view' }
  | { type: 'status_view' }
  | { type: 'static' }
  | { type: 'static_sites_view' }
  | { type: 'data' }
  | { type: 'backups_view' }
  | { type: 'config' }
  | { type: 'home_view' };

export interface MenuItem {
  value: string;
  label: string;
  hint?: string;
  statusDot?: string;
  statusColor?: string;
  isBack?: boolean;
}

interface TerminalRequest {
  type: 'terminal';
  run: () => Promise<void>;
  pause: boolean;
  returnScreen: ScreenState;
}

interface ExitRequest {
  type: 'exit';
}

type TuiResolution = TerminalRequest | ExitRequest;

interface LiveInteractiveTuiProps {
  ctx: Ctx;
  initialScreen: ScreenState;
  onResolve: (res: TuiResolution) => void;
}

/* ------------------------------------------------------------------ */
/*  Native Subview Components                                         */
/* ------------------------------------------------------------------ */

function ConnectionInfoView({ ctx }: { ctx: Ctx }) {
  const e = ctx.env;
  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Connection Details & Credentials
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">
          MySQL
        </Text>
        <Text>{`  Host: localhost:${e.MYSQL_PORT}   Database: ${e.MYSQL_DATABASE}`}</Text>
        <Text>{`  User: ${e.MYSQL_USER}   Password: ${e.MYSQL_PASSWORD}`}</Text>
        <Text dimColor>{`  URL: mysql://${e.MYSQL_USER}:${e.MYSQL_PASSWORD}@localhost:${e.MYSQL_PORT}/${e.MYSQL_DATABASE}`}</Text>
        <Text dimColor>{`  In stack: ${e.MYSQL_CONTAINER_NAME}:3306`}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="red">
          Redis
        </Text>
        <Text>{`  Host: localhost:${e.REDIS_PORT}`}</Text>
        <Text dimColor>{`  URL: redis://localhost:${e.REDIS_PORT}`}</Text>
        <Text dimColor>{`  In stack: ${e.REDIS_CONTAINER_NAME}:6379`}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">
          PostgreSQL
        </Text>
        <Text>{`  Host: localhost:${e.POSTGRES_PORT}   Database: ${e.POSTGRES_DB}`}</Text>
        <Text>{`  User: ${e.POSTGRES_USER}   Password: ${e.POSTGRES_PASSWORD}`}</Text>
        <Text dimColor>{`  URL: postgresql://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@localhost:${e.POSTGRES_PORT}/${e.POSTGRES_DB}`}</Text>
        <Text dimColor>{`  In stack: ${e.POSTGRES_CONTAINER_NAME}:5432`}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Web UIs & Tools
        </Text>
        <Text>{`  phpMyAdmin:  http://localhost:${e.PMA_PORT}`}</Text>
        <Text>{`  pgAdmin:     http://localhost:${e.PGADMIN_PORT} (user: ${e.PGADMIN_DEFAULT_EMAIL})`}</Text>
        <Text>{`  Mailpit:     http://localhost:${e.MAILPIT_HTTP_PORT} (SMTP: :${e.MAILPIT_SMTP_PORT})`}</Text>
        <Text>{`  MinIO UI:    http://localhost:${e.MINIO_CONSOLE_PORT} (API: :${e.MINIO_API_PORT})`}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Monitor
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

function DoctorView({ ctx }: { ctx: Ctx }) {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    let active = true;
    void runDoctorChecks(ctx).then((res) => {
      if (active) setChecks(res);
    });
    return () => {
      active = false;
    };
  }, [ctx]);

  if (!checks) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="yellow">  ⠋ Running environment checks (Docker, permissions, .env)...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Environment Diagnostics (Doctor)
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        {checks.map((c, i) => {
          const mark = c.level === 'ok' ? '✔' : c.level === 'warn' ? '⚠' : '✖';
          const colorName = c.level === 'ok' ? 'green' : c.level === 'warn' ? 'yellow' : 'red';
          return (
            <Box key={i} flexDirection="column" marginBottom={c.hint ? 1 : 0}>
              <Box>
                <Text color={colorName}>{`  ${mark} `}</Text>
                <Text bold>{c.name.padEnd(18)}</Text>
                <Text>{c.detail}</Text>
              </Box>
              {c.hint ? (
                <Box paddingLeft={4}>
                  <Text dimColor>{`Hint: ${c.hint}`}</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Monitor
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

function StatusView({ ctx, data }: { ctx: Ctx; data: DashboardData | null }) {
  const running = data?.services.filter((s) => s.status === 'running' || s.status === 'healthy').length ?? 0;
  const stopped = data?.services.filter((s) => s.status === 'stopped' || s.status === 'missing').length ?? 0;

  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Stack Status Overview
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text>  Live status is continually updating in the dashboard table above.</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text>{`  • Active containers: ${running} running · ${stopped} stopped`}</Text>
        <Text>{`  • Docker network:    ${ctx.env.NETWORK_NAME || 'public-service-network'}`}</Text>
        <Text>{`  • State directory:   ${tildify(ctx.home)}`}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Monitor
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

function BackupsView({ ctx }: { ctx: Ctx }) {
  const backups = listBackups(ctx.home);

  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {`Database Backup Archives (${backups.length})`}
        </Text>
      </Box>
      {backups.length === 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>  No backup files found in backups/ directory.</Text>
          <Text dimColor>  Use 'Data & backups › Create a backup' to dump databases.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          {backups.map((b, i) => {
            const sizeMb = (b.size / 1_048_576).toFixed(1);
            const dateStr = new Date(b.mtime).toLocaleString();
            return (
              <Box key={i}>
                <Text color="green">  ● </Text>
                <Text bold>{b.file.padEnd(36)}</Text>
                <Text color="yellow">{`${sizeMb} MB`.padEnd(12)}</Text>
                <Text dimColor>{dateStr}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Data & backups
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

function StaticSitesView({ ctx }: { ctx: Ctx }) {
  const sites = getSiteSummaries(ctx);

  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {`Deployed Static & SSR Applications (${sites.length})`}
        </Text>
      </Box>
      {sites.length === 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>  No web applications deployed yet.</Text>
          <Text dimColor>  Use 'Deploy a site' or 'pubservices static add' to add Next.js, Vite, Nuxt, etc.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          {sites.map((s) => {
            const isSsr = s.deployMode === 'ssr';
            const size =
              s.bytes >= 1_048_576
                ? `${(s.bytes / 1_048_576).toFixed(1)} MB`
                : `${(s.bytes / 1024).toFixed(0)} KB`;
            const badge = isSsr ? `SSR · :${s.port ?? '—'}` : `${s.files} files · ${size}`;
            const url = isSsr ? `http://localhost:${s.port ?? ''}` : `http://localhost/${s.name}`;

            return (
              <Box key={s.name} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color="green">  ● </Text>
                  <Text bold>{s.name.padEnd(22)}</Text>
                  <Text color="cyan">{badge.padEnd(24)}</Text>
                  <Text>{url}</Text>
                </Box>
                {s.source ? (
                  <Box paddingLeft={4}>
                    <Text dimColor>{`Source: ${s.source}`}</Text>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Static & SSR apps
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

function HomeView({ ctx }: { ctx: Ctx }) {
  return (
    <Box flexDirection="column" paddingY={0}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          State Directory (PUBSERVICES_HOME)
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold>Path: </Text>
        <Text color="cyan">{ctx.home}</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Managed Contents:</Text>
        <Text dimColor>  • .env                  Active credentials and service ports</Text>
        <Text dimColor>  • docker-compose.yml    Multi-container stack definition</Text>
        <Text dimColor>  • nginx/                Proxy settings & web app sites</Text>
        <Text dimColor>  • mysql/                Custom configuration overrides</Text>
        <Text dimColor>  • backups/              Database dumps and snapshots</Text>
        <Text dimColor>  • state.json            CLI state and static site registrations</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="cyan">  ● </Text>
          <Text bold color="cyan">
            ← Back to Configuration
          </Text>
        </Box>
        <Text dimColor>    [Press Esc, b, or Enter to return]</Text>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Interactive Live TUI Component                                    */
/* ------------------------------------------------------------------ */

function LiveInteractiveTui({ ctx, initialScreen, onResolve }: LiveInteractiveTuiProps) {
  const { exit } = useApp();
  const allServices = getAllServices(ctx.env, ctx.home);

  const [data, setData] = useState<DashboardData | null>(null);
  const [screen, setScreen] = useState<ScreenState>(initialScreen);
  const [cursor, setCursor] = useState(0);
  const [columns, setColumns] = useState(() => (process.stdout.isTTY ? process.stdout.columns || 80 : 80));
  const [screenMountedAt, setScreenMountedAt] = useState(() => Date.now());

  const [executing, setExecuting] = useState<{ title: string; progress: string } | null>(null);
  const [actionResult, setActionResult] = useState<{
    title: string;
    success: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  // Keep terminal width in sync for responsive centering
  useEffect(() => {
    const onResize = () => setColumns(process.stdout.columns || 80);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  // Poll live dashboard data
  const refresh = useCallback(async () => {
    try {
      const d = await getDashboardData(ctx);
      setData(d);
    } catch {
      // transient glitch
    }
  }, [ctx]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Reset cursor and record timestamp whenever screen changes
  useEffect(() => {
    setCursor(0);
    setScreenMountedAt(Date.now());
  }, [screen]);

  // Accurately resolve service status from live inspection
  const getServiceStatus = useCallback(
    (s: ServiceInfo): ContainerStatus => {
      if (!data) return 'missing';
      const row = data.services.find(
        (r) =>
          r.key === s.key ||
          r.container === s.container ||
          r.label.toLowerCase() === s.label.toLowerCase(),
      );
      return row?.status ?? 'stopped';
    },
    [data],
  );

  // Execute an inline command without leaving the live TUI
  const runInlineAction = useCallback(
    async (title: string, progress: string, fn: () => Promise<string | void>) => {
      setExecuting({ title, progress });
      const capturedLogs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        capturedLogs.push(args.map(String).join(' '));
      };
      try {
        const res = await fn();
        await refresh();
        setActionResult({
          title,
          success: true,
          message: res || capturedLogs.slice(-2).join(' ') || `${title} completed.`,
        });
      } catch (err: unknown) {
        await refresh();
        let message = 'Command failed.';
        let hint: string | undefined;
        if (err instanceof UserError) {
          message = err.message;
          hint = err.hint;
        } else if (err instanceof Error) {
          message = err.message;
        }
        setActionResult({
          title,
          success: false,
          message,
          hint,
        });
      } finally {
        console.log = origLog;
        setExecuting(null);
      }
    },
    [refresh],
  );

  // Request external terminal handover
  const requestTerminalAction = useCallback(
    (run: () => Promise<void>, pause: boolean, returnScreen: ScreenState) => {
      onResolve({ type: 'terminal', run, pause, returnScreen });
      exit();
    },
    [onResolve, exit],
  );

  // Clean exit
  const exitApp = useCallback(() => {
    onResolve({ type: 'exit' });
    exit();
  }, [onResolve, exit]);

  // Breadcrumbs and Menu Items resolution based on screen
  let breadcrumb = 'Main Menu';
  let subtitle: string | undefined = 'Select an operation category:';
  let items: MenuItem[] = [];
  let customView: React.ReactNode = null;

  switch (screen.type) {
    case 'root':
      breadcrumb = 'Main Menu';
      subtitle = 'Select an operation category:';
      items = [
        { value: 'services', label: 'Services', hint: 'start · stop · restart · manage single' },
        { value: 'monitor', label: 'Monitor', hint: 'connection info · health · logs · doctor' },
        { value: 'static', label: 'Static & SSR apps', hint: 'deploy · list · update · mount' },
        { value: 'data', label: 'Data & backups', hint: 'backup · list · restore · reset' },
        { value: 'config', label: 'Configuration & env', hint: '.env · custom.cnf · state dir' },
        { value: 'exit', label: 'Exit', hint: 'quit pubservices' },
      ];
      break;

    case 'services':
      breadcrumb = 'Services';
      subtitle = 'Stack operations:';
      items = [
        { value: 'up', label: 'Start core', hint: 'MySQL + Redis' },
        { value: 'up-proxy', label: 'Start core + Nginx', hint: 'MySQL + Redis + Nginx' },
        { value: 'up-full', label: 'Start everything', hint: 'all services & web UIs' },
        { value: 'manage', label: 'Manage a service ›', hint: 'select single service to control' },
        { value: 'restart', label: 'Restart all', hint: 'restart running containers' },
        { value: 'down', label: 'Stop all', hint: 'data is preserved' },
        { value: 'reload', label: 'Reload Nginx config', hint: 'zero downtime reload' },
        { value: 'build', label: 'Rebuild images', hint: 'pubservices build' },
        { value: 'back', label: '← Back to main menu', isBack: true },
      ];
      break;

    case 'service_list':
      breadcrumb = 'Services › Manage a service';
      subtitle = 'Select a service to control:';
      items = [
        ...allServices.map((s) => {
          const st = getServiceStatus(s);
          const isLive = st === 'healthy' || st === 'running';
          const isStarting = st === 'starting';
          return {
            value: s.key,
            label: s.label,
            hint: `${st} · ${s.address} (${s.profile ? `profile: ${s.profile}` : 'core'})`,
            statusDot: isLive || isStarting ? DOT.running : DOT.stopped,
            statusColor: isLive ? 'green' : isStarting ? 'yellow' : 'gray',
          };
        }),
        { value: 'back', label: '← Back to services', isBack: true },
      ];
      break;

    case 'service_detail': {
      const svc = allServices.find((s) => s.key === screen.serviceKey) ?? allServices[0]!;
      const st = getServiceStatus(svc);
      const isRunning = st === 'healthy' || st === 'running' || st === 'starting';
      const isDatabase = svc.key === 'mysql' || svc.key === 'postgres' || svc.key === 'redis';
      const isNginx = svc.key === 'nginx';

      breadcrumb = `Services › Manage › ${svc.label}`;
      subtitle = `${svc.container} · ${svc.address} (${st})`;

      items = [];
      if (!isRunning) {
        items.push({ value: 'up', label: 'Start service', hint: `pubservices up ${svc.key}` });
      } else {
        items.push({ value: 'restart', label: 'Restart service', hint: `pubservices restart ${svc.key}` });
        items.push({ value: 'down', label: 'Stop service', hint: `pubservices down ${svc.key}` });
      }

      if (isDatabase) {
        items.push({
          value: 'backup',
          label: svc.key === 'redis' ? 'Backup data' : 'Backup database',
          hint: isRunning ? `dump ${svc.label} into backups/` : 'service must be running',
        });
      }

      if (isNginx && isRunning) {
        items.push({ value: 'reload', label: 'Reload Nginx config', hint: 'pubservices reload-proxy' });
      }

      if (isRunning) {
        items.push({ value: 'shell', label: 'Enter container shell', hint: 'interactive bash/sh' });
        items.push({ value: 'logs', label: 'Follow logs', hint: `pubservices logs ${svc.key}` });
      }

      items.push({ value: 'config', label: 'Edit configuration', hint: 'open config in $EDITOR' });
      items.push({ value: 'build', label: 'Rebuild image', hint: `pubservices build ${svc.key}` });
      items.push({ value: 'back', label: '← Back to service list', isBack: true });
      break;
    }

    case 'service_configs': {
      const svc = allServices.find((s) => s.key === screen.serviceKey) ?? allServices[0]!;
      breadcrumb = `Services › Manage › ${svc.label} › Config`;
      subtitle = `Select configuration file for ${svc.label}:`;
      const configs = serviceConfigFiles(ctx, svc.key);
      items = [
        ...configs.map((c) => ({
          value: c.path,
          label: c.label,
          hint: c.hint,
        })),
        { value: 'back', label: '← Back to service', isBack: true },
      ];
      break;
    }

    case 'monitor':
      breadcrumb = 'Monitor';
      subtitle = 'Diagnostic & inspection tools:';
      items = [
        { value: 'info', label: 'Connection info', hint: 'view credentials, hosts & ports' },
        { value: 'status', label: 'Status overview', hint: 'stack health breakdown' },
        { value: 'doctor', label: 'Doctor', hint: 'verify system environment & daemon' },
        { value: 'logs', label: 'Follow logs ›', hint: 'choose container to tail' },
        { value: 'back', label: '← Back to main menu', isBack: true },
      ];
      break;

    case 'connection_info':
      breadcrumb = 'Monitor › Connection info';
      customView = <ConnectionInfoView ctx={ctx} />;
      break;

    case 'doctor_view':
      breadcrumb = 'Monitor › Doctor';
      customView = <DoctorView ctx={ctx} />;
      break;

    case 'status_view':
      breadcrumb = 'Monitor › Status';
      customView = <StatusView ctx={ctx} data={data} />;
      break;

    case 'logs_service_select':
      breadcrumb = 'Monitor › Follow logs';
      subtitle = 'Select service to follow logs:';
      items = [
        ...allServices.map((s) => ({
          value: s.key,
          label: s.label,
          hint: s.container,
        })),
        { value: 'back', label: '← Back to monitor', isBack: true },
      ];
      break;

    case 'static':
      breadcrumb = 'Static & SSR apps';
      subtitle = 'Manage web apps & host mounts:';
      items = [
        { value: 'list', label: 'List sites', hint: 'show active apps and URLs' },
        { value: 'add', label: 'Deploy a site', hint: 'smart detection (Next, Vite, etc.)' },
        { value: 'update', label: 'Update all sites', hint: 'rebuild and deploy all' },
        { value: 'remove', label: 'Remove a site', hint: 'delete deployed site' },
        { value: 'mount', label: 'Mount a host directory', hint: 'mount dir into Nginx' },
        { value: 'unmount', label: 'Remove host mount', hint: 'unmount from Nginx' },
        { value: 'back', label: '← Back to main menu', isBack: true },
      ];
      break;

    case 'static_sites_view':
      breadcrumb = 'Static & SSR apps › Deployed Sites';
      customView = <StaticSitesView ctx={ctx} />;
      break;

    case 'data':
      breadcrumb = 'Data & backups';
      subtitle = 'Database storage & backups:';
      items = [
        { value: 'backup', label: 'Create a backup', hint: 'dump all active databases' },
        { value: 'backups', label: 'List backups', hint: 'show archive files in backups/' },
        { value: 'restore', label: 'Restore from a backup', hint: 'restore database dump' },
        { value: 'reset', label: 'Reset all data', hint: 'purge data directories' },
        { value: 'back', label: '← Back to main menu', isBack: true },
      ];
      break;

    case 'backups_view':
      breadcrumb = 'Data & backups › Archive List';
      customView = <BackupsView ctx={ctx} />;
      break;

    case 'config':
      breadcrumb = 'Configuration & environment';
      subtitle = 'Configuration & state paths:';
      items = [
        { value: 'edit', label: 'Edit .env', hint: 'open ~/.pubservices/.env in $EDITOR' },
        { value: 'home', label: 'Show state directory', hint: 'show PUBSERVICES_HOME layout' },
        { value: 'back', label: '← Back to main menu', isBack: true },
      ];
      break;

    case 'home_view':
      breadcrumb = 'Configuration › State Directory';
      customView = <HomeView ctx={ctx} />;
      break;
  }

  // Navigation and selection handler
  const selectCurrent = useCallback(() => {
    const selected = items[cursor];
    if (!selected) return;

    if (selected.value === 'back') {
      if (screen.type === 'root') {
        exitApp();
      } else if (
        screen.type === 'services' ||
        screen.type === 'monitor' ||
        screen.type === 'static' ||
        screen.type === 'data' ||
        screen.type === 'config'
      ) {
        setScreen({ type: 'root' });
      } else if (screen.type === 'service_list') {
        setScreen({ type: 'services' });
      } else if (screen.type === 'service_detail') {
        setScreen({ type: 'service_list' });
      } else if (screen.type === 'service_configs') {
        setScreen({ type: 'service_detail', serviceKey: screen.serviceKey });
      } else if (screen.type === 'logs_service_select') {
        setScreen({ type: 'monitor' });
      }
      return;
    }

    if (screen.type === 'root') {
      if (selected.value === 'services') setScreen({ type: 'services' });
      else if (selected.value === 'monitor') setScreen({ type: 'monitor' });
      else if (selected.value === 'static') setScreen({ type: 'static' });
      else if (selected.value === 'data') setScreen({ type: 'data' });
      else if (selected.value === 'config') setScreen({ type: 'config' });
      else if (selected.value === 'exit') exitApp();
      return;
    }

    if (screen.type === 'services') {
      if (selected.value === 'manage') {
        setScreen({ type: 'service_list' });
      } else if (selected.value === 'up') {
        void runInlineAction('Start core', 'Starting MySQL and Redis...', async () => {
          await upCommand(ctx, undefined, {});
          return 'Started core services (MySQL, Redis).';
        });
      } else if (selected.value === 'up-proxy') {
        void runInlineAction('Start core + Nginx', 'Starting MySQL, Redis, and Nginx...', async () => {
          await upCommand(ctx, undefined, { proxy: true });
          return 'Started core services and Nginx.';
        });
      } else if (selected.value === 'up-full') {
        void runInlineAction('Start all', 'Starting all services...', async () => {
          await upCommand(ctx, undefined, { full: true });
          return 'Started all services.';
        });
      } else if (selected.value === 'restart') {
        void runInlineAction('Restart all', 'Restarting running stack...', async () => {
          await restartCommand(ctx, undefined, {});
          return 'All services restarted.';
        });
      } else if (selected.value === 'down') {
        void runInlineAction('Stop all', 'Stopping services (data preserved)...', async () => {
          await downCommand({ ...ctx, yes: true }, undefined, {});
          return 'All services stopped.';
        });
      } else if (selected.value === 'reload') {
        void runInlineAction('Reload Nginx', 'Reloading proxy configuration...', async () => {
          await reloadProxyCommand(ctx);
          return 'Nginx configuration reloaded.';
        });
      } else if (selected.value === 'build') {
        void runInlineAction('Rebuild images', 'Rebuilding docker images...', async () => {
          await buildCommand(ctx, undefined, {});
          return 'Docker images rebuilt successfully.';
        });
      }
      return;
    }

    if (screen.type === 'service_list') {
      setScreen({ type: 'service_detail', serviceKey: selected.value });
      return;
    }

    if (screen.type === 'service_detail') {
      const svc = allServices.find((s) => s.key === screen.serviceKey) ?? allServices[0]!;

      if (selected.value === 'up') {
        void runInlineAction(`Start ${svc.label}`, `Starting ${svc.container}...`, async () => {
          await upCommand(ctx, svc.key, {});
          return `${svc.label} started successfully.`;
        });
      } else if (selected.value === 'restart') {
        void runInlineAction(`Restart ${svc.label}`, `Restarting ${svc.container}...`, async () => {
          await restartCommand(ctx, svc.key, {});
          return `${svc.label} restarted successfully.`;
        });
      } else if (selected.value === 'down') {
        void runInlineAction(`Stop ${svc.label}`, `Stopping ${svc.container}...`, async () => {
          await downCommand({ ...ctx, yes: true }, svc.key, {});
          return `${svc.label} stopped.`;
        });
      } else if (selected.value === 'backup') {
        void runInlineAction(`Backup ${svc.label}`, `Dumping database for ${svc.label}...`, async () => {
          await backupCommand(ctx, svc.key);
          return `Backup created for ${svc.label}.`;
        });
      } else if (selected.value === 'reload') {
        void runInlineAction('Reload Nginx', 'Reloading proxy configuration...', async () => {
          await reloadProxyCommand(ctx);
          return 'Nginx configuration reloaded.';
        });
      } else if (selected.value === 'build') {
        void runInlineAction(`Rebuild ${svc.label}`, `Rebuilding image for ${svc.container}...`, async () => {
          await buildCommand(ctx, svc.key, {});
          return `${svc.label} image rebuilt.`;
        });
      } else if (selected.value === 'shell') {
        requestTerminalAction(
          async () => {
            await execShellCommand(ctx, svc.key);
          },
          false,
          screen,
        );
      } else if (selected.value === 'logs') {
        requestTerminalAction(
          async () => {
            await logsCommand(ctx, svc.key, {});
          },
          false,
          screen,
        );
      } else if (selected.value === 'config') {
        const configs = serviceConfigFiles(ctx, svc.key);
        if (configs.length > 1) {
          setScreen({ type: 'service_configs', serviceKey: svc.key });
        } else {
          requestTerminalAction(
            async () => {
              await editServiceConfig(ctx, svc.key, configs[0]?.path);
            },
            false,
            screen,
          );
        }
      }
      return;
    }

    if (screen.type === 'service_configs') {
      const svc = allServices.find((s) => s.key === screen.serviceKey) ?? allServices[0]!;
      requestTerminalAction(
        async () => {
          await editServiceConfig(ctx, svc.key, selected.value);
        },
        false,
        screen,
      );
      return;
    }

    if (screen.type === 'monitor') {
      if (selected.value === 'info') {
        setScreen({ type: 'connection_info' });
      } else if (selected.value === 'status') {
        setScreen({ type: 'status_view' });
      } else if (selected.value === 'doctor') {
        setScreen({ type: 'doctor_view' });
      } else if (selected.value === 'logs') {
        setScreen({ type: 'logs_service_select' });
      }
      return;
    }

    if (screen.type === 'logs_service_select') {
      requestTerminalAction(
        async () => {
          await logsCommand(ctx, selected.value, {});
        },
        false,
        screen,
      );
      return;
    }

    if (screen.type === 'static') {
      if (selected.value === 'list') {
        setScreen({ type: 'static_sites_view' });
      } else if (selected.value === 'add') {
        requestTerminalAction(
          async () => {
            await staticAdd(ctx, undefined, undefined);
          },
          true,
          screen,
        );
      } else if (selected.value === 'update') {
        void runInlineAction('Update static sites', 'Updating web applications...', async () => {
          await staticUpdate(ctx, undefined);
          return 'Static sites updated.';
        });
      } else if (selected.value === 'remove') {
        requestTerminalAction(
          async () => {
            await staticRemove(ctx, undefined);
          },
          true,
          screen,
        );
      } else if (selected.value === 'mount') {
        requestTerminalAction(
          async () => {
            await staticMount(ctx, undefined);
          },
          true,
          screen,
        );
      } else if (selected.value === 'unmount') {
        requestTerminalAction(
          async () => {
            await staticUnmount(ctx);
          },
          true,
          screen,
        );
      }
      return;
    }

    if (screen.type === 'data') {
      if (selected.value === 'backup') {
        void runInlineAction('Backup databases', 'Dumping active databases...', async () => {
          await backupCommand(ctx);
          return 'Backups completed successfully.';
        });
      } else if (selected.value === 'backups') {
        setScreen({ type: 'backups_view' });
      } else if (selected.value === 'restore') {
        requestTerminalAction(
          async () => {
            await restoreCommand(ctx, undefined);
          },
          true,
          screen,
        );
      } else if (selected.value === 'reset') {
        requestTerminalAction(
          async () => {
            await resetCommand(ctx);
          },
          true,
          screen,
        );
      }
      return;
    }

    if (screen.type === 'config') {
      if (selected.value === 'edit') {
        requestTerminalAction(
          async () => {
            await editCommand(ctx);
          },
          false,
          screen,
        );
      } else if (selected.value === 'home') {
        setScreen({ type: 'home_view' });
      }
    }
  }, [items, cursor, screen, exitApp, runInlineAction, ctx, allServices, requestTerminalAction]);

  // Back navigation helper
  const goBack = useCallback(() => {
    if (screen.type === 'root') {
      exitApp();
    } else if (
      screen.type === 'services' ||
      screen.type === 'monitor' ||
      screen.type === 'static' ||
      screen.type === 'data' ||
      screen.type === 'config'
    ) {
      setScreen({ type: 'root' });
    } else if (screen.type === 'service_list') {
      setScreen({ type: 'services' });
    } else if (screen.type === 'service_detail') {
      setScreen({ type: 'service_list' });
    } else if (screen.type === 'service_configs') {
      setScreen({ type: 'service_detail', serviceKey: screen.serviceKey });
    } else if (screen.type === 'logs_service_select') {
      setScreen({ type: 'monitor' });
    } else if (
      screen.type === 'connection_info' ||
      screen.type === 'doctor_view' ||
      screen.type === 'status_view'
    ) {
      setScreen({ type: 'monitor' });
    } else if (screen.type === 'static_sites_view') {
      setScreen({ type: 'static' });
    } else if (screen.type === 'backups_view') {
      setScreen({ type: 'data' });
    } else if (screen.type === 'home_view') {
      setScreen({ type: 'config' });
    }
  }, [screen, exitApp]);

  // Input Handling
  useInput((input, key) => {
    if (executing) return;

    if (actionResult) {
      if (key.return || key.escape || input === ' ' || input === 'q') {
        setActionResult(null);
      }
      return;
    }

    // In custom views (connection info, doctor, backups, etc.), allow viewing without bouncing out
    if (customView) {
      if (key.escape || key.leftArrow || input === 'b' || input === 'q') {
        goBack();
        return;
      }
      // Require deliberate keypress (450ms guard) to avoid bounce-back from parent menu Enter
      if (key.return || input === ' ') {
        if (Date.now() - screenMountedAt > 450) {
          goBack();
        }
        return;
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor((c) => (c - 1 + items.length) % items.length);
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => (c + 1) % items.length);
    } else if (key.return || key.rightArrow) {
      selectCurrent();
    } else if (key.escape || key.leftArrow || input === 'b') {
      goBack();
    } else if (input === 'q') {
      if (screen.type === 'root') {
        exitApp();
      } else {
        setScreen({ type: 'root' });
      }
    } else if (input === 'R') {
      void refresh();
    }
  });

  // Calculate layout centering margins
  const targetWidth = DASHBOARD_BOX_WIDTH;
  const leftPad = Math.max(0, Math.floor((columns - targetWidth) / 2));

  return (
    <Box flexDirection="column" paddingLeft={leftPad}>
      {/* Pinned Live Dashboard at the top */}
      {data ? (
        <Text>{renderDashboard(data)}</Text>
      ) : (
        <Text dimColor>  … loading live dashboard</Text>
      )}

      {/* Breadcrumb Header */}
      <Box marginTop={1} flexDirection="column" width={targetWidth}>
        <Box>
          <Text color="cyan" bold>
            {`  ◆ ${breadcrumb}`}
          </Text>
        </Box>
      </Box>

      {/* Menu Container Card */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        width={targetWidth}
        paddingX={1}
        paddingY={0}
        marginTop={0}
      >
        {executing ? (
          <Box flexDirection="column" paddingY={1}>
            <Text color="yellow" bold>
              {`  ⠋ ${executing.title}`}
            </Text>
            <Text dimColor>{`    ${executing.progress}`}</Text>
          </Box>
        ) : actionResult ? (
          <Box flexDirection="column" paddingY={1}>
            <Text color={actionResult.success ? 'green' : 'red'} bold>
              {`  ${actionResult.success ? '✔' : '✖'} ${actionResult.title}`}
            </Text>
            <Box marginTop={1}>
              <Text>{`    ${actionResult.message}`}</Text>
            </Box>
            {actionResult.hint && <Text dimColor>{`    ${actionResult.hint}`}</Text>}
            <Box marginTop={1}>
              <Text dimColor>{'    [Press Enter or Esc to continue]'}</Text>
            </Box>
          </Box>
        ) : customView ? (
          customView
        ) : (
          <Box flexDirection="column">
            {subtitle ? (
              <Box marginBottom={1}>
                <Text dimColor>{`  ${subtitle}`}</Text>
              </Box>
            ) : null}

            {items.map((item, idx) => {
              const isSelected = idx === cursor;
              return (
                <Box key={item.value}>
                  <Text color={isSelected ? 'cyan' : 'gray'}>
                    {isSelected ? ' ● ' : ' ○ '}
                  </Text>
                  {item.statusDot ? (
                    <Text color={item.statusColor}>{`${item.statusDot} `}</Text>
                  ) : null}
                  <Text
                    bold={isSelected}
                    color={item.isBack ? (isSelected ? 'cyan' : 'gray') : isSelected ? 'cyan' : undefined}
                  >
                    {item.label}
                  </Text>
                  {item.hint ? <Text dimColor>{` · ${item.hint}`}</Text> : null}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Footer shortcut bar */}
      <Box marginTop={0} width={targetWidth}>
        <Text dimColor>
          {'  ↑↓ navigate   enter select   esc back   q exit   R refresh'}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Runs the interactive TUI with a live ticking dashboard pinned at top
 * and responsive horizontal centering matching terminal geometry.
 */
export async function runLiveTui(ctx: Ctx): Promise<void> {
  let currentScreen: ScreenState = { type: 'root' };

  while (true) {
    let result: TuiResolution | undefined;

    clearScreen();
    const app = render(
      <LiveInteractiveTui
        ctx={ctx}
        initialScreen={currentScreen}
        onResolve={(res) => {
          result = res;
        }}
      />,
    );

    await app.waitUntilExit();

    if (!result || result.type === 'exit') {
      say.blank();
      return;
    }

    const terminalReq = result;
    clearScreen();

    // Trap SIGINT during external prompts or interactive commands so Ctrl+C
    // cancels the child action rather than terminating the parent Node process.
    const onSigint = () => {};
    process.on('SIGINT', onSigint);

    try {
      await terminalReq.run();
    } catch (err: unknown) {
      if (err instanceof UserError) {
        say.fail(err.message);
        if (err.hint) say.meta(`  ${err.hint}`);
      } else {
        console.error(err);
      }
    } finally {
      process.off('SIGINT', onSigint);
    }

    // For interactive commands that output results, wait for the user to review
    if (terminalReq.pause && process.stdin.isTTY) {
      say.blank();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      await new Promise<void>((resolve) => {
        rl.question(color.meta('  Press Enter to return to menu... '), () => {
          rl.close();
          resolve();
        });
      });
    }

    // Cleanly restore and resume stdin for the next TUI iteration
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
    }

    currentScreen = terminalReq.returnScreen;
  }
}

/** Legacy wrapper kept for backward compatibility. */
export async function runLiveMainMenu(ctx: Ctx): Promise<string> {
  await runLiveTui(ctx);
  return 'exit';
}
