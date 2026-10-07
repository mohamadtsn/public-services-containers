import { confirm as clackConfirm, isCancel, text as clackText } from '@clack/prompts';
import type { Ctx } from './context.js';
import { UserError } from './ui.js';

/**
 * Asks for confirmation unless the caller passed --yes or stdin is not a TTY.
 * Cancelling (Ctrl+C) is treated as "no", never as "yes".
 */
export async function confirm(ctx: Ctx, message: string, initial = false): Promise<boolean> {
  if (ctx.yes) return true;
  const answer = await clackConfirm({ message, initialValue: initial });
  if (isCancel(answer)) return false;
  return answer;
}

/**
 * Requires the exact word to be typed. Used for irreversible data deletion,
 * where a single keystroke is too cheap a confirmation.
 */
export async function confirmPhrase(ctx: Ctx, message: string, phrase: string): Promise<boolean> {
  if (ctx.yes) return true;
  const answer = await clackText({
    message,
    placeholder: phrase,
    validate: (v) => (v === phrase ? undefined : `Type "${phrase}" to confirm.`),
  });
  if (isCancel(answer)) return false;
  return answer === phrase;
}

export async function ask(ctx: Ctx, message: string, placeholder?: string): Promise<string> {
  if (ctx.yes) throw new UserError(`${message} is required when running with --yes.`);
  const answer = await clackText(placeholder ? { message, placeholder } : { message });
  if (isCancel(answer) || !answer) throw new UserError('Cancelled.');
  return answer;
}
