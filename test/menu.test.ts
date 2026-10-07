import { describe, expect, it } from 'vitest';
import { MENU_GROUPS, runMenu } from '../src/menu.js';
import { UserError } from '../src/ui.js';

/**
 * Commands that must be reachable from the interactive menu.
 *
 * Excluded on purpose: `run` and `home` are shell plumbing, `completion` is a
 * one-time setup step, and `restore <file>` / `backups --prune` are covered by
 * their interactive equivalents.
 */
const MUST_BE_REACHABLE = [
  'status',
  'info',
  'doctor',
  'up',
  'down',
  'restart',
  'logs',
  'build',
  'reload-proxy',
  'edit',
  'backup',
  'backups',
  'restore',
  'reset',
  'static list',
  'static add',
  'static update',
  'static remove',
  'static mount',
  'static unmount',
];

describe('interactive menu', () => {
  const actions = MENU_GROUPS.flatMap((g) => g.actions);
  const commands = new Set(actions.map((a) => a.command.split(' --')[0]!));

  it('exposes every command a user would otherwise have to type', () => {
    const missing = MUST_BE_REACHABLE.filter((c) => !commands.has(c));
    expect(missing).toEqual([]);
  });

  it('gives each action a unique value inside its group', () => {
    for (const group of MENU_GROUPS) {
      const values = group.actions.map((a) => a.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('reserves no action value that the menu itself uses for navigation', () => {
    for (const group of MENU_GROUPS) {
      expect(group.actions.some((a) => a.value === 'back')).toBe(false);
      expect(group.value).not.toBe('exit');
    }
  });

  it('refuses to open without a terminal instead of hanging on a prompt', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      await expect(
        runMenu({ home: '/tmp/nowhere', env: {} as never, json: false, yes: true, created: false }),
      ).rejects.toThrow(UserError);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });
});
