import { join } from 'node:path';
import type { Ctx } from '../context.js';
import { run } from '../docker.js';
import { UserError, color, say } from '../ui.js';

/** Opens the home .env in $EDITOR (or $VISUAL, or nano). */
export async function editCommand(ctx: Ctx): Promise<void> {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  const file = join(ctx.home, '.env');
  const res = await run(editor, [file], { stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`${editor} exited with ${res.code}.`);
  say.ok(`Saved ${file}`);
  say.meta('  Restart affected services for changes to take effect: pubservices restart');
}

/** Runs an arbitrary command with the home directory as the working directory. */
export async function runCommand(ctx: Ctx, argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd) {
    throw new UserError('No command specified.', 'Example: pubservices run docker compose ps');
  }
  say.meta(`${color.meta(ctx.home)} $ ${argv.join(' ')}`);
  const res = await run(cmd, args, { cwd: ctx.home, stdio: 'inherit' });
  if (res.code !== 0) process.exitCode = res.code;
}
