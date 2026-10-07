/**
 * Every visual decision lives here. No ANSI escapes anywhere else in the codebase.
 * picocolors self-disables on NO_COLOR / non-TTY.
 */
import { homedir } from 'node:os';
import pc from 'picocolors';
import type { ContainerStatus } from './docker.js';

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

export interface DashboardServiceRow {
  key: string;
  label: string;
  status: ContainerStatus;
  uptime: string;
  address: string;
  ip: string;
}

export interface DashboardData {
  version: string;
  home: string;
  docker: string | null;
  compose: string | null;
  network: string;
  backupsCount: number;
  backupsSize: string;
  appsCount: number;
  updatedAt?: string;
  services: DashboardServiceRow[];
}

/**
 * Renders the rich, aesthetic ASCII dashboard displayed at the CLI entry
 * and pinned at the top of the interactive menu.
 */
export function renderDashboard(data: DashboardData): string {
  const running = data.services.filter((s) => s.status === 'running' || s.status === 'healthy').length;
  const healthy = data.services.filter((s) => s.status === 'healthy').length;
  const stopped = data.services.filter((s) => s.status === 'stopped' || s.status === 'missing').length;

  const colService = Math.max(14, ...data.services.map((s) => width(s.label)));
  const colStatus = 12;
  const colUptime = Math.max(9, ...data.services.map((s) => width(s.uptime)));
  const colAddress = Math.max(24, ...data.services.map((s) => width(s.address)));
  const colIp = Math.max(11, ...data.services.map((s) => width(s.ip)));

  const tableHeader = [
    pad('SERVICE', colService),
    pad('STATUS', colStatus),
    pad('UPTIME', colUptime),
    pad('PORT / ADDRESS', colAddress),
    pad('INTERNAL IP', colIp),
  ].join('   ');

  const contentWidth = width(tableHeader);

  const left1 = `${color.meta('Stack')}    ${color.ok(symbol.on)} ${running} running${healthy > 0 ? ` (${healthy} healthy)` : ''}   ${color.meta(`${symbol.off} ${stopped} stopped`)}`;
  const left2 = `${color.meta('Network')}  ${color.brand(data.network)}`;
  const left3 = `${color.meta('Backups')}  ${data.backupsCount > 0 ? `${data.backupsCount} archives (${data.backupsSize})` : color.meta('none')}`;

  const right1 = `${color.meta('Docker')}   ${data.docker ? `${data.docker}${data.compose ? color.meta(` · Compose v${data.compose}`) : ''}` : color.err('daemon offline')}`;
  const right2 = `${color.meta('Home')}     ${color.meta(tildify(data.home))}`;
  const right3 = `${color.meta('Apps')}     ${data.appsCount > 0 ? `${data.appsCount} deployed` : color.meta('none')}`;

  const leftMax = Math.max(width(left1), width(left2), width(left3));
  const rightMax = Math.max(width(right1), width(right2), width(right3));
  const inner = Math.max(contentWidth, leftMax + 4 + rightMax) + 4;

  const head = '─ PUBSERVICES ';
  const tag = data.updatedAt
    ? ` v${data.version} · ${color.ok(symbol.on + ' LIVE')} ${color.meta(data.updatedAt)} ─`
    : ` v${data.version} ─`;
  const fill = '─'.repeat(Math.max(0, inner - width(head) - width(tag)));

  const lines: string[] = [];
  lines.push(color.brand(`╭${head}${fill}${tag}╮`));

  const printLine = (content: string) => {
    const gap = inner - width(content);
    lines.push(`${color.brand('│')}${content}${' '.repeat(Math.max(0, gap))}${color.brand('│')}`);
  };

  const printSplit = (left: string, right: string) => {
    printLine(`  ${pad(left, leftMax)}    ${right}`);
  };

  lines.push(`${color.brand('│')}${' '.repeat(inner)}${color.brand('│')}`);
  printSplit(left1, right1);
  printSplit(left2, right2);
  printSplit(left3, right3);
  lines.push(`${color.brand('│')}${' '.repeat(inner)}${color.brand('│')}`);

  lines.push(color.brand(`├${'─'.repeat(inner)}┤`));
  printLine(`  ${color.bold(color.meta(tableHeader))}  `);
  lines.push(color.brand(`├${'─'.repeat(inner)}┤`));

  for (const s of data.services) {
    const isLive = s.status === 'running' || s.status === 'healthy';
    const statusText =
      s.status === 'healthy'
        ? color.ok(`${symbol.on} healthy`)
        : s.status === 'running'
          ? color.ok(`${symbol.on} running`)
          : s.status === 'starting'
            ? color.warn(`${symbol.on} starting`)
            : s.status === 'unhealthy'
              ? color.err(`${symbol.on} unhealthy`)
              : s.status === 'stopped'
                ? color.warn(`${symbol.off} stopped`)
                : color.meta(`${symbol.off} missing`);

    const uptimeText = isLive ? color.meta(s.uptime) : color.meta('—');
    const addressText = isLive ? color.brand(s.address) : color.meta(s.address);
    const ipText = isLive && s.ip !== '—' ? color.meta(s.ip) : color.meta('—');

    const rowStr = [
      pad(color.bold(s.label), colService),
      pad(statusText, colStatus),
      pad(uptimeText, colUptime),
      pad(addressText, colAddress),
      pad(ipText, colIp),
    ].join('   ');

    printLine(`  ${rowStr}  `);
  }

  lines.push(color.brand(`╰${'─'.repeat(inner)}╯`));
  return lines.join('\n');
}

/** Clears the terminal screen and scrollback buffer on interactive terminals. */
export function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
  }
}

/** Thrown for expected failures: printed as one clean line, no stack trace. */
export class UserError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}
