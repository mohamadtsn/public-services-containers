import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  type CommandSpec,
  completionTarget,
  renderCompletion,
  specsFrom,
} from '../src/commands/completion.js';

function sampleProgram(): Command {
  const program = new Command();
  program.command('status').description('service health');
  program
    .command('logs')
    .argument('[service]', 'one service')
    .description('follow logs');
  const group = program.command('static').description('static sites');
  group.command('add').description('add a site');
  group.command('list').description('list sites');
  program.command('static-add', { hidden: true }).description('legacy alias');
  return program;
}

describe('completion generation', () => {
  const specs: CommandSpec[] = specsFrom(sampleProgram());

  it('reads commands, service arguments and subcommands from the CLI itself', () => {
    // Generated, not hand-maintained: v1 shipped three static files that drifted.
    expect(specs.map((s) => s.name)).toEqual(['status', 'logs', 'static']);
    expect(specs.find((s) => s.name === 'logs')?.takesService).toBe(true);
    expect(specs.find((s) => s.name === 'status')?.takesService).toBe(false);
    expect(specs.find((s) => s.name === 'static')?.subcommands.map((c) => c.name)).toEqual([
      'add',
      'list',
    ]);
  });

  it('omits hidden legacy aliases from completions', () => {
    expect(specs.some((s) => s.name === 'static-add')).toBe(false);
  });

  for (const shell of ['bash', 'zsh', 'fish'] as const) {
    it(`renders a ${shell} script containing every command`, () => {
      const script = renderCompletion(shell, specs);
      for (const spec of specs) expect(script).toContain(spec.name);
      expect(script).toContain('mysql');
      expect(script.length).toBeGreaterThan(100);
    });
  }

  it('targets user-owned directories only, so installing needs no root', () => {
    for (const shell of ['bash', 'zsh', 'fish'] as const) {
      const { dir } = completionTarget(shell);
      expect(dir.startsWith('/etc')).toBe(false);
      expect(dir.startsWith('/usr')).toBe(false);
    }
  });
});

describe('tildify', () => {
  it('shortens paths under the home directory and leaves others alone', async () => {
    const { tildify } = await import('../src/ui.js');
    const { homedir } = await import('node:os');
    const home = homedir();
    expect(tildify(`${home}/.pubservices`)).toBe('~/.pubservices');
    expect(tildify(home)).toBe('~');
    expect(tildify('/usr/local/lib/x')).toBe('/usr/local/lib/x');
    // A sibling directory whose name merely starts with the home path must not match.
    expect(tildify(`${home}-other/x`)).toBe(`${home}-other/x`);
  });
});
