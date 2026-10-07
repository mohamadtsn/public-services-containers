import { cancel, intro, isCancel, outro, select } from '@clack/prompts';
import { backupCommand, backupsCommand } from './commands/backup.js';
import { doctorCommand } from './commands/doctor.js';
import { infoCommand } from './commands/info.js';
import { buildCommand, downCommand, logsCommand, restartCommand, upCommand } from './commands/lifecycle.js';
import { reloadProxyCommand } from './commands/reload.js';
import { resetCommand } from './commands/reset.js';
import { restoreCommand } from './commands/restore.js';
import { editCommand } from './commands/shell.js';
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
import { services } from './env.js';
import { packageVersion } from './home.js';
import { UserError, color, say, tildify } from './ui.js';

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

export const MENU_GROUPS: Group[] = [
  {
    value: 'services',
    label: 'Services',
    hint: 'start · stop · restart · rebuild',
    actions: [
      { value: 'up', label: 'Start core', hint: 'MySQL + Redis', command: 'up', run: (c) => upCommand(c, undefined, {}) },
      { value: 'up-proxy', label: 'Start core + Nginx', command: 'up --proxy', run: (c) => upCommand(c, undefined, { proxy: true }) },
      { value: 'up-full', label: 'Start everything', command: 'up --full', run: (c) => upCommand(c, undefined, { full: true }) },
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
      {
        value: 'dash',
        label: 'Live dashboard',
        hint: 'takes over the terminal',
        command: 'dash',
        run: async (c) => {
          const { runDash } = await import('./dash.js');
          await runDash(c);
          return true;
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

  intro(`${color.brand(color.bold('pubservices'))} ${color.meta(`v${packageVersion()} · ${tildify(ctx.home)}`)}`);

  for (;;) {
    const group = await select({
      message: 'What do you want to do?',
      options: [
        ...MENU_GROUPS.map((g) => ({ value: g.value, label: g.label, hint: g.hint })),
        { value: 'exit', label: 'Exit', hint: '' },
      ],
    });

    if (isCancel(group) || group === 'exit') {
      cancel('Bye.');
      return;
    }

    const chosen = MENU_GROUPS.find((g) => g.value === group);
    if (!chosen) continue;

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
    if (action === 'back') continue;

    const selected = chosen.actions.find((a) => a.value === action);
    if (!selected) continue;

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
  }
}
