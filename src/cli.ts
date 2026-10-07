import { Command, Option } from 'commander';
import { backupCommand, backupsCommand, pruneBackups } from './commands/backup.js';
import { completionInstall, completionPrint, specsFrom } from './commands/completion.js';
import { doctorCommand } from './commands/doctor.js';
import { infoCommand } from './commands/info.js';
import {
  type BuildOptions,
  type LogsOptions,
  type UpOptions,
  buildCommand,
  downCommand,
  logsCommand,
  restartCommand,
  upCommand,
} from './commands/lifecycle.js';
import { type MigrateOptions, migrateCommand } from './commands/migrate.js';
import { reloadProxyCommand } from './commands/reload.js';
import { type ResetOptions, resetCommand } from './commands/reset.js';
import { restoreCommand } from './commands/restore.js';
import { editCommand, runCommand } from './commands/shell.js';
import { updateCommand } from './commands/update.js';
import {
  type StaticAddOptions,
  type StaticUpdateOptions,
  staticAdd,
  staticList,
  staticMount,
  staticRemove,
  staticUnmount,
  staticUpdate,
} from './commands/static.js';
import { statusCommand } from './commands/status.js';
import { type Ctx, type GlobalOptions, context } from './context.js';
import { packageVersion } from './home.js';
import { runMenu } from './menu.js';
import type { ProfileFlags } from './profiles.js';
import { UserError, color, say } from './ui.js';

const program = new Command();

program
  .name('pubservices')
  .description('Shared Docker infrastructure for local development')
  .version(packageVersion(), '-v, --version', 'print the installed version')
  .addOption(
    new Option('--home <path>', 'override the state directory').env('PUBSERVICES_HOME'),
  )
  .option('--json', 'machine-readable output')
  .option('-y, --yes', 'skip confirmation prompts')
  .showHelpAfterError()
  .configureHelp({ showGlobalOptions: true });

/** Global options live on the root command regardless of where they were typed. */
const globals = (): GlobalOptions => program.opts<GlobalOptions>();

program
  .command('status')
  .description('service health and ports')
  .action(async () => statusCommand(context(globals())));

program
  .command('info')
  .description('connection details for every service')
  .action(() => infoCommand(context(globals())));

program
  .command('doctor')
  .description('check the environment and report anything that needs fixing')
  .action(async () => doctorCommand(context(globals())));

program
  .command('dash')
  .description('live dashboard with service controls')
  .action(async () => {
    const ctx = context(globals());
    if (!process.stdout.isTTY) {
      throw new UserError(
        'The dashboard needs a terminal.',
        'Use: pubservices status --json',
      );
    }
    // Imported on demand so React and Ink are never loaded for plain commands.
    const { runDash } = await import('./dash.js');
    await runDash(ctx);
  });

program
  .command('home')
  .description('print the state directory path')
  .action(() => console.log(context(globals()).home));

/** Profile selection shared by every lifecycle command. */
const withProfiles = (cmd: Command): Command =>
  cmd
    .option('--proxy', 'include Nginx')
    .option('--pma', 'include phpMyAdmin')
    .option('--mail', 'include Mailpit')
    .option('--storage', 'include MinIO')
    .option('--postgres', 'include PostgreSQL')
    .option('--pgadmin', 'include pgAdmin')
    .option('--full', 'include every optional service');

withProfiles(
  program
    .command('up')
    .argument('[service]', 'start one service instead of the whole stack')
    .description('start services (core only unless a profile is given)')
    .option('--build', 'rebuild images before starting'),
).action(async (service: string | undefined, opts: UpOptions) =>
  upCommand(context(globals()), service, opts),
);

withProfiles(
  program
    .command('down')
    .argument('[service]', 'stop one service instead of the whole stack')
    .description('stop services (data is preserved)'),
).action(async (service: string | undefined, opts: ProfileFlags) =>
  downCommand(context(globals()), service, opts),
);

withProfiles(
  program
    .command('restart')
    .argument('[service]', 'restart one service instead of the whole stack')
    .description('restart services'),
).action(async (service: string | undefined, opts: ProfileFlags) =>
  restartCommand(context(globals()), service, opts),
);

withProfiles(
  program
    .command('logs')
    .argument('[service]', 'follow one service instead of all')
    .description('follow service logs')
    .option('-n, --tail <lines>', 'lines of history to show', '100')
    .option('--no-follow', 'print and exit instead of streaming'),
).action(async (service: string | undefined, opts: LogsOptions) =>
  logsCommand(context(globals()), service, opts),
);

withProfiles(
  program
    .command('build')
    .argument('[service]', 'build one service instead of all')
    .description('rebuild Docker images')
    .option('--no-cache', 'build without the layer cache'),
).action(async (service: string | undefined, opts: BuildOptions) =>
  buildCommand(context(globals()), service, opts),
);

program
  .command('reload-proxy')
  .description('test and reload the Nginx configuration')
  .action(async () => reloadProxyCommand(context(globals())));

program
  .command('edit')
  .description('open .env in $EDITOR')
  .action(async () => editCommand(context(globals())));

program
  .command('run')
  .argument('<command...>', 'command to execute')
  .description('run a command with the state directory as the working directory')
  .action(async (argv: string[]) => runCommand(context(globals()), argv));

program
  .command('backup')
  .description('dump MySQL and copy Redis data into backups/')
  .action(async () => backupCommand(context(globals())));

program
  .command('backups')
  .description('list existing backup archives')
  .option('--prune <keep>', 'delete all but the newest <keep> archives')
  .action(async (opts: { prune?: string }) => {
    const ctx = context(globals());
    if (opts.prune === undefined) return backupsCommand(ctx);
    const keep = Number(opts.prune);
    if (!Number.isInteger(keep) || keep < 1) {
      throw new UserError('--prune expects a positive whole number.');
    }
    return pruneBackups(ctx, keep);
  });

program
  .command('restore')
  .argument('[file]', 'backup archive; omit to choose from backups/')
  .description('restore MySQL and Redis from a backup archive')
  .action(async (file: string | undefined) => restoreCommand(context(globals()), file));

program
  .command('reset')
  .description('stop everything and delete all data (destructive)')
  .option('--purge', 'also delete .env and generated config')
  .action(async (opts: ResetOptions) => resetCommand(context(globals()), opts));

const staticCmd = program
  .command('static')
  .description('manage static sites served from nginx/static/');

staticCmd
  .command('add')
  .argument('[name]')
  .argument('[source]', 'project directory or build output directory')
  .option('--build', 'force a fresh build before deploying')
  .option('--no-build', 'skip the build step even if output is missing')
  .description('detect framework, build if needed, and deploy a site')
  .action(async (name: string | undefined, source: string | undefined, opts: StaticAddOptions) =>
    staticAdd(context(globals()), name, source, opts),
  );

staticCmd
  .command('update')
  .argument('[name]', 'omit to update every site with a recorded source')
  .option('--build', 'rebuild the project before syncing')
  .description('re-sync a static site or restart an SSR container')
  .action(async (name: string | undefined, opts: StaticUpdateOptions) =>
    staticUpdate(context(globals()), name, opts),
  );

staticCmd
  .command('remove')
  .argument('[name]')
  .description('delete a static site from nginx/static/')
  .action(async (name: string | undefined) => staticRemove(context(globals()), name));

staticCmd
  .command('list')
  .description('list static sites')
  .action(() => staticList(context(globals())));

staticCmd
  .command('mount')
  .argument('[path]', 'host directory to expose to nginx (default: your home directory)')
  .description('bind a host directory into nginx at the same path (read-only)')
  .action(async (path: string | undefined) => staticMount(context(globals()), path));

staticCmd
  .command('unmount')
  .description('remove the generated docker-compose.override.yml')
  .action(async () => staticUnmount(context(globals())));

/** v1 spelled these with hyphens; keep them working, but out of the help output. */
type StaticAlias = (ctx: Ctx, a?: string, b?: string) => Promise<void> | void;

const STATIC_ALIASES: Array<[string, StaticAlias]> = [
  ['static-add', (ctx, a, b) => staticAdd(ctx, a, b)],
  ['static-update', (ctx, a) => staticUpdate(ctx, a)],
  ['static-remove', (ctx, a) => staticRemove(ctx, a)],
  ['static-list', (ctx) => staticList(ctx)],
  ['static-mount', (ctx, a) => staticMount(ctx, a)],
  ['static-unmount', (ctx) => staticUnmount(ctx)],
];

for (const [name, handler] of STATIC_ALIASES) {
  program
    .command(name, { hidden: true })
    .argument('[a]')
    .argument('[b]')
    .action(async (a: string | undefined, b: string | undefined) => {
      await handler(context(globals()), a, b);
    });
}

program
  .command('migrate')
  .description('copy a v1 installation into the state directory')
  .option('--from <path>', 'source installation (default: /usr/local/lib/public-services-containers)')
  .option('--config-only', 'copy configuration but not data')
  .action(async (opts: MigrateOptions) => migrateCommand(context(globals()), opts));

program
  .command('update')
  .description('check npm for a newer release and install it')
  .action(async () => updateCommand(context(globals())));

const completionCmd = program
  .command('completion')
  .description('shell completions for bash, zsh and fish');

completionCmd
  .command('install')
  .argument('[shell]', 'bash, zsh or fish; omit to install all three')
  .description('write completion files into your own config directories')
  .action((shell: string | undefined) => completionInstall(shell, specsFrom(program)));

completionCmd
  .command('show')
  .argument('[shell]', 'bash, zsh or fish; defaults to $SHELL')
  .description('print the completion script to stdout')
  .action((shell: string | undefined) => completionPrint(shell, specsFrom(program)));

/**
 * No arguments: show status, then the menu when a terminal is attached.
 * Piped or scripted invocations get the status output alone.
 */
program.action(async () => {
  const ctx = context(globals());
  await statusCommand(ctx);
  if (process.stdin.isTTY && !ctx.json) await runMenu(ctx);
});

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  if (err instanceof UserError) {
    say.fail(err.message);
    if (err.hint) say.meta(`  ${err.hint}`);
    process.exitCode = 1;
    return;
  }
  say.fail(err instanceof Error ? err.message : String(err));
  say.meta(`  ${color.meta('Run pubservices doctor for a diagnosis.')}`);
  process.exitCode = 1;
});
