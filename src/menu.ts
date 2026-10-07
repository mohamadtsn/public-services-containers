import { cancel, intro, isCancel, outro, select } from '@clack/prompts';
import { backupCommand, backupsCommand } from './commands/backup.js';
import { doctorCommand } from './commands/doctor.js';
import { infoCommand } from './commands/info.js';
import { buildCommand, downCommand, logsCommand, restartCommand, upCommand } from './commands/lifecycle.js';
import { reloadProxyCommand } from './commands/reload.js';
import { resetCommand } from './commands/reset.js';
import { restoreCommand } from './commands/restore.js';
import { editCommand, editServiceConfig, execShellCommand } from './commands/shell.js';
import {
  staticAdd,
  staticList,
  staticMount,
  staticRemove,
  staticUnmount,
  staticUpdate,
} from './commands/static.js';
import { statusCommand } from './commands/status.js';
import type { Ctx } from './context.js';
import { inspectMany } from './docker.js';
import { services } from './env.js';
import { packageVersion } from './home.js';
import { UserError, clearScreen, color, say } from './ui.js';

interface Action {
  value: string;
  label: string;
  hint?: string;
  /**
   * The equivalent CLI command. Not used at runtime — it documents the mapping
   * and lets a test prove every command is reachable from the menu, so adding a
   * command without a menu entry fails CI instead of going unnoticed.
   */
  command: string;
  /** Returning false ends the session (the command took over the terminal). */
  run: (ctx: Ctx) => Promise<boolean | void> | boolean | void;
}

interface Group {
  value: string;
  label: string;
  hint: string;
  actions: Action[];
}

async function pausePrompt(): Promise<void> {
  if (!process.stdin.isTTY) return;
  say.blank();
  await select({
    message: 'Action completed',
    options: [{ value: 'continue', label: '← Return to menu' }],
  });
}

async function pickService(ctx: Ctx, message: string): Promise<string | null> {
  const choice = await select({
    message,
    options: services(ctx.env).map((s) => ({
      value: s.key,
      label: s.label,
      hint: s.profile ? `profile: ${s.profile}` : 'core',
    })),
  });
  return isCancel(choice) ? null : (choice as string);
}

/** Interactive menu to manage an individual service (start, stop, restart, logs, build). */
async function manageServiceMenu(ctx: Ctx): Promise<boolean | void> {
  const allServices = services(ctx.env);

  for (;;) {
    clearScreen();
    intro(`${color.brand(color.bold('pubservices'))} ${color.meta(`v${packageVersion()} · Manage a service`)}`);

    const statuses = await inspectMany(allServices.map((s) => s.container));

    const choice = await select({
      message: 'Select a service to manage:',
      options: [
        ...allServices.map((s) => {
          const st = statuses.get(s.container) ?? 'stopped';
          return {
            value: s.key,
            label: s.label,
            hint: `${st} · ${s.address}`,
          };
        }),
        { value: 'back', label: '← Back to services', hint: '' },
      ],
    });

    if (isCancel(choice) || choice === 'back') {
      return;
    }

    const svc = allServices.find((s) => s.key === choice);
    if (!svc) continue;

    for (;;) {
      clearScreen();
      const svcStatuses = await inspectMany([svc.container]);
      const currentSt = svcStatuses.get(svc.container) ?? 'stopped';
      const isRunning = currentSt === 'healthy' || currentSt === 'running' || currentSt === 'starting';
      const isDatabase = svc.key === 'mysql' || svc.key === 'postgres' || svc.key === 'redis';
      const isNginx = svc.key === 'nginx';

      intro(`${color.brand(color.bold(svc.label))} ${color.meta(`${svc.container} · ${svc.address} (${currentSt})`)}`);

      interface OptionItem {
        value: string;
        label: string;
        hint?: string;
      }

      const options: OptionItem[] = [];

      if (!isRunning) {
        options.push({ value: 'up', label: 'Start service', hint: `pubservices up ${svc.key}` });
      } else {
        options.push({ value: 'restart', label: 'Restart service', hint: `pubservices restart ${svc.key}` });
        options.push({ value: 'down', label: 'Stop service', hint: `pubservices down ${svc.key}` });
      }

      if (isDatabase) {
        options.push({
          value: 'backup',
          label: svc.key === 'redis' ? 'Backup data' : 'Backup database',
          hint: isRunning ? `dump ${svc.label} into backups/` : 'service must be running',
        });
      }

      if (isNginx && isRunning) {
        options.push({ value: 'reload', label: 'Reload Nginx config', hint: 'pubservices reload-proxy' });
      }

      if (isRunning) {
        options.push({ value: 'shell', label: 'Enter container shell', hint: 'open interactive bash/sh' });
        options.push({ value: 'logs', label: 'Follow logs', hint: `pubservices logs ${svc.key}` });
      }

      options.push({ value: 'config', label: 'Edit configuration', hint: 'open config in $EDITOR' });
      options.push({ value: 'build', label: 'Rebuild image', hint: `pubservices build ${svc.key}` });
      options.push({ value: 'back', label: '← Back to service list', hint: '' });

      const action = await select({
        message: `Action for ${svc.label}:`,
        options,
      });

      if (isCancel(action) || action === 'back') {
        break;
      }

      clearScreen();
      intro(`${color.brand(color.bold(svc.label))} ${color.meta(`Action: ${action}`)}`);

      let skipPause = false;

      try {
        if (action === 'up') {
          await upCommand(ctx, svc.key, {});
        } else if (action === 'down') {
          await downCommand(ctx, svc.key, {});
        } else if (action === 'restart') {
          await restartCommand(ctx, svc.key, {});
        } else if (action === 'backup') {
          await backupCommand(ctx, svc.key);
        } else if (action === 'reload') {
          await reloadProxyCommand(ctx);
        } else if (action === 'shell') {
          await execShellCommand(ctx, svc.key);
          skipPause = true;
        } else if (action === 'config') {
          await editServiceConfig(ctx, svc.key);
          skipPause = true;
        } else if (action === 'logs') {
          await logsCommand(ctx, svc.key, {});
          return false;
        } else if (action === 'build') {
          await buildCommand(ctx, svc.key, {});
        }
      } catch (err) {
        if (err instanceof UserError) {
          say.fail(err.message);
          if (err.hint) say.meta(`  ${err.hint}`);
        } else {
          throw err;
        }
      }

      if (!skipPause) {
        await pausePrompt();
      }
    }
  }
}

export const MENU_GROUPS: Group[] = [
  {
    value: 'services',
    label: 'Services',
    hint: 'start · stop · restart · rebuild',
    actions: [
      { value: 'up', label: 'Start core', hint: 'MySQL + Redis', command: 'up', run: (c) => upCommand(c, undefined, {}) },
      { value: 'up-proxy', label: 'Start core + Nginx', command: 'up --proxy', run: (c) => upCommand(c, undefined, { proxy: true }) },
      { value: 'up-full', label: 'Start everything', command: 'up --full', run: (c) => upCommand(c, undefined, { full: true }) },
      { value: 'single', label: 'Manage a service', hint: 'start · stop · restart · logs · rebuild', command: 'up', run: (c) => manageServiceMenu(c) },
      { value: 'restart', label: 'Restart all', command: 'restart', run: (c) => restartCommand(c, undefined, {}) },
      { value: 'down', label: 'Stop all', hint: 'data is preserved', command: 'down', run: (c) => downCommand(c, undefined, {}) },
      { value: 'reload', label: 'Reload Nginx config', command: 'reload-proxy', run: (c) => reloadProxyCommand(c) },
      { value: 'build', label: 'Rebuild images', command: 'build', run: (c) => buildCommand(c, undefined, {}) },
    ],
  },
  {
    value: 'monitor',
    label: 'Monitor',
    hint: 'status · connection info · logs',
    actions: [
      { value: 'status', label: 'Status', command: 'status', run: (c) => statusCommand(c) },
      { value: 'info', label: 'Connection info', command: 'info', run: (c) => infoCommand(c) },
      {
        value: 'logs',
        label: 'Follow logs',
        hint: 'takes over the terminal',
        command: 'logs',
        run: async (c) => {
          const service = await pickService(c, 'Which service?');
          if (!service) return true;
          await logsCommand(c, service, {});
          return false;
        },
      },
      { value: 'doctor', label: 'Doctor', hint: 'check the environment', command: 'doctor', run: (c) => doctorCommand(c) },
    ],
  },
  {
    value: 'static',
    label: 'Static sites',
    hint: 'add · update · remove — auto-detects Next.js, Nuxt, Vite, CRA',
    actions: [
      { value: 'list', label: 'List sites', command: 'static list', run: (c) => staticList(c) },
      { value: 'add', label: 'Deploy a site', hint: 'smart detection', command: 'static add', run: (c) => staticAdd(c, undefined, undefined) },
      { value: 'update', label: 'Update all sites', command: 'static update', run: (c) => staticUpdate(c, undefined) },
      { value: 'remove', label: 'Remove a site', command: 'static remove', run: (c) => staticRemove(c, undefined) },
      { value: 'mount', label: 'Mount a host directory into Nginx', command: 'static mount', run: (c) => staticMount(c, undefined) },
      { value: 'unmount', label: 'Remove the host mount', command: 'static unmount', run: (c) => staticUnmount(c) },
    ],
  },
  {
    value: 'data',
    label: 'Data',
    hint: 'backup · restore · reset',
    actions: [
      { value: 'backup', label: 'Create a backup', command: 'backup', run: (c) => backupCommand(c) },
      { value: 'backups', label: 'List backups', command: 'backups', run: (c) => backupsCommand(c) },
      { value: 'restore', label: 'Restore from a backup', command: 'restore', run: (c) => restoreCommand(c, undefined) },
      {
        value: 'reset',
        label: 'Reset all data',
        hint: 'destructive',
        command: 'reset',
        run: (c) => resetCommand(c),
      },
    ],
  },
  {
    value: 'config',
    label: 'Config',
    hint: 'edit .env · paths',
    actions: [
      { value: 'edit', label: 'Edit .env', command: 'edit', run: (c) => editCommand(c) },
      {
        value: 'home',
        label: 'Show the state directory',
        command: 'home',
        run: (c) => {
          say.blank();
          console.log(`  ${c.home}`);
          say.blank();
        },
      },
    ],
  },
];

/**
 * The no-argument experience. Every action here is also a plain command, so
 * nothing is menu-only and scripts never need to drive a prompt.
 */
export async function runMenu(ctx: Ctx): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new UserError(
      'The interactive menu needs a terminal.',
      'Use a command instead, for example: pubservices status --json',
    );
  }

  for (;;) {
    clearScreen();
    const { runLiveMainMenu } = await import('./dash.js');
    const group = await runLiveMainMenu(ctx);

    if (group === 'exit') {
      cancel('Bye.');
      return;
    }

    const chosen = MENU_GROUPS.find((g) => g.value === group);
    if (!chosen) continue;

    for (;;) {
      clearScreen();
      intro(`${color.brand(color.bold('pubservices'))} ${color.meta(`v${packageVersion()} · ${chosen.label}`)}`);

      const action = await select({
        message: chosen.label,
        options: [
          ...chosen.actions.map((a) => ({ value: a.value, label: a.label, hint: a.hint })),
          { value: 'back', label: '← Back', hint: '' },
        ],
      });

      if (isCancel(action)) {
        cancel('Bye.');
        return;
      }
      if (action === 'back') break;

      const selected = chosen.actions.find((a) => a.value === action);
      if (!selected) continue;

      if (selected.value !== 'single') {
        clearScreen();
        intro(`${color.brand(color.bold(selected.label))} ${color.meta(selected.command)}`);
      }

      try {
        const keepGoing = await selected.run(ctx);
        if (keepGoing === false) {
          outro('Done.');
          return;
        }
      } catch (err) {
        // One failed action must not end the session — show it and offer the menu again.
        if (err instanceof UserError) {
          say.fail(err.message);
          if (err.hint) say.meta(`  ${err.hint}`);
        } else {
          throw err;
        }
      }

      if (selected.value !== 'single') {
        await pausePrompt();
      }
    }
  }
}
