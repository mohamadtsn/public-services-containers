/**
 * Every visual decision lives here. No ANSI escapes anywhere else in the codebase.
 * picocolors self-disables on NO_COLOR / non-TTY.
 */
import { homedir } from 'node:os';
import pc from 'picocolors';

export const color = {
  brand: pc.cyan,
  ok: pc.green,
  warn: pc.yellow,
  err: pc.red,
  meta: pc.dim,
  bold: pc.bold,
};

export const symbol = {
  on: '●',
  off: '○',
  ok: '✓',
  fail: '✗',
  warn: '⚠',
  step: '›',
} as const;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export const stripAnsi = (s: string): string => s.replace(ANSI, '');

/** Visible width of a string, ignoring color codes. */
export const width = (s: string): number => stripAnsi(s).length;

/** Pad to `n` visible columns (ANSI-aware, unlike String.padEnd). */
export function pad(s: string, n: number): string {
  const gap = n - width(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

export interface BoxOptions {
  title: string;
  /** Right-aligned text on the top border, e.g. a version. */
  tag?: string;
  rows: string[][];
  /** Lines printed under the box, dimmed. */
  footer?: string[];
}

/**
 * Renders the framed table used by `status`. Columns are sized from content,
 * so adding a service or a longer port string never breaks the alignment.
 */
export function box({ title, tag, rows, footer = [] }: BoxOptions): string {
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const widths = Array.from({ length: cols }, (_, i) =>
    rows.reduce((n, r) => Math.max(n, width(r[i] ?? '')), 0),
  );

  const body = rows.map((r) => widths.map((w, i) => pad(r[i] ?? '', w)).join('   ').trimEnd());

  const head = `─ ${title} `;
  const tail = tag ? ` ${tag} ─` : '';
  const inner = Math.max(...body.map(width), width(head) + width(tail));

  const lines: string[] = [];
  const fill = '─'.repeat(Math.max(0, inner + 2 - width(head) - width(tail)));
  lines.push(color.brand(`╭${head}${fill}${tail}╮`));
  for (const l of body) lines.push(`${color.brand('│')} ${pad(l, inner)} ${color.brand('│')}`);
  lines.push(color.brand(`╰${'─'.repeat(inner + 2)}╯`));
  for (const f of footer) lines.push(`  ${color.meta(f)}`);

  return lines.join('\n');
}

/** Shortens a path under the user's home to `~/...` for display only. */
export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * A titled block of aligned label/value pairs — the layout used by `info` and
 * `doctor`, where a framed table would add noise without adding structure.
 */
export function section(title: string, pairs: Array<[string, string]>, indent = '  '): string {
  const labelWidth = pairs.reduce((n, [k]) => Math.max(n, width(k)), 0);
  const lines = [`${indent}${color.bold(title)}`];
  for (const [k, v] of pairs) {
    lines.push(`${indent}  ${color.meta(pad(k, labelWidth))}  ${v}`);
  }
  return lines.join('\n');
}

export const say = {
  step: (m: string) => console.log(`${color.brand(symbol.step)} ${m}`),
  ok: (m: string) => console.log(`${color.ok(symbol.ok)} ${m}`),
  warn: (m: string) => console.log(`${color.warn(symbol.warn)} ${m}`),
  fail: (m: string) => console.error(`${color.err(symbol.fail)} ${m}`),
  meta: (m: string) => console.log(color.meta(m)),
  blank: () => console.log(''),
};

/** Thrown for expected failures: printed as one clean line, no stack trace. */
export class UserError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}
