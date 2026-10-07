import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Ctx, emitJson } from '../context.js';
import { run } from '../docker.js';
import { readState, updateState } from '../state.js';
import { confirm } from '../prompt.js';
import { ask } from '../prompt.js';
import { UserError, color, say } from '../ui.js';

/** Path inside the nginx container that nginx/static/ is mounted at. */
const CONTAINER_ROOT = '/srv/static';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function staticDir(home: string): string {
  return join(home, 'nginx', 'static');
}

function siteDir(home: string, name: string): string {
  assertName(name);
  return join(staticDir(home), name);
}

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new UserError(
      `Invalid site name: ${name}`,
      'Use letters, digits, dot, dash or underscore — no slashes.',
    );
  }
}

function expand(p: string): string {
  return resolve(p.replace(/^~(?=$|\/)/, homedir()));
}

/**
 * Source directories were kept in nginx/static/.sources/<name> by v1 and live
 * in state.json now. Read both so an upgraded installation keeps working, and
 * fold the old files into state on the way.
 */
function sources(ctx: Ctx): Record<string, string> {
  const state = readState(ctx.home);
  const legacyDir = join(staticDir(ctx.home), '.sources');
  if (!existsSync(legacyDir)) return state.staticSources;

  const merged = { ...state.staticSources };
  let changed = false;
  for (const file of readdirSync(legacyDir)) {
    if (merged[file]) continue;
    const value = readFileSync(join(legacyDir, file), 'utf8').trim();
    if (value) {
      merged[file] = value;
      changed = true;
    }
  }
  if (changed) updateState(ctx.home, { staticSources: merged });
  return merged;
}

function rememberSource(ctx: Ctx, name: string, src: string): void {
  const next = { ...sources(ctx), [name]: src };
  updateState(ctx.home, { staticSources: next });
}

function forgetSource(ctx: Ctx, name: string): void {
  const next = { ...sources(ctx) };
  delete next[name];
  updateState(ctx.home, { staticSources: next });
}

/**
 * Mirrors `src` into nginx/static/<name>, removing files that no longer exist
 * in the source. rsync does this in one pass; without it, the destination is
 * rebuilt from scratch, which is slower but equivalent.
 */
async function sync(home: string, name: string, src: string): Promise<void> {
  const dest = siteDir(home, name);
  mkdirSync(dest, { recursive: true });

  const hasRsync = (await run('rsync', ['--version']).catch(() => null))?.code === 0;

  if (hasRsync) {
    // --checksum, not rsync's default size+mtime quick check: a rebuild that
    // changes only a content hash keeps the file size identical, and if it lands
    // in the same second as the previous sync the quick check skips it, leaving
    // nginx serving the old bundle. Build output is small, so hashing is cheap.
    // ponytail: drop --checksum if anyone ever syncs a multi-GB asset tree here.
    const res = await run('rsync', ['-a', '--checksum', '--delete', `${src}/`, `${dest}/`]);
    if (res.code !== 0) throw new UserError('rsync failed.', res.stderr.trim());
    return;
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

interface SiteSummary {
  name: string;
  path: string;
  containerPath: string;
  files: number;
  bytes: number;
  source: string | null;
}

function summarize(ctx: Ctx): SiteSummary[] {
  const dir = staticDir(ctx.home);
  if (!existsSync(dir)) return [];
  const saved = sources(ctx);

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const path = join(dir, e.name);
      let files = 0;
      let bytes = 0;
      for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        files += 1;
        bytes += statSync(join(entry.parentPath, entry.name)).size;
      }
      return {
        name: e.name,
        path,
        containerPath: `${CONTAINER_ROOT}/${e.name}`,
        files,
        bytes,
        source: saved[e.name] ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function staticAdd(
  ctx: Ctx,
  nameArg: string | undefined,
  srcArg: string | undefined,
): Promise<void> {
  const name = nameArg ?? (await ask(ctx, 'Site name', 'myapp'));
  assertName(name);

  const src = expand(srcArg ?? (await ask(ctx, 'Build output directory', '~/projects/myapp/dist')));
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new UserError(`Source directory not found: ${src}`);
  }

  say.step(`Syncing into nginx/static/${name}...`);
  await sync(ctx.home, name, src);
  rememberSource(ctx, name, src);

  say.blank();
  say.ok(`Synced to ${siteDir(ctx.home, name)}`);
  say.meta(`  container path  ${CONTAINER_ROOT}/${name}`);
  say.blank();
  say.meta('  Register it once with local-dev-proxy:');
  console.log(
    `  ${color.brand(`devproxy create -h ${name}.local --static --root ${CONTAINER_ROOT}/${name}`)}`,
  );
  say.meta(`  After each rebuild:  pubservices static update ${name}`);
  say.blank();
}

export async function staticUpdate(ctx: Ctx, nameArg: string | undefined): Promise<void> {
  const saved = sources(ctx);

  const names = nameArg ? [nameArg] : Object.keys(saved);
  if (names.length === 0) {
    say.warn('No static site has a recorded source directory.');
    say.meta('  Add one with: pubservices static add <name> <source-dir>');
    return;
  }

  for (const name of names) {
    assertName(name);
    const src = saved[name];
    if (!src) {
      throw new UserError(
        `No recorded source for ${name}.`,
        `Re-add it: pubservices static add ${name} <source-dir>`,
      );
    }
    if (!existsSync(src)) {
      throw new UserError(`Source directory no longer exists: ${src}`);
    }
    await sync(ctx.home, name, src);
    say.ok(`${name} ${color.meta(`← ${src}`)}`);
  }
}

export async function staticRemove(ctx: Ctx, nameArg: string | undefined): Promise<void> {
  const name = nameArg ?? (await ask(ctx, 'Site name to remove'));
  const dest = siteDir(ctx.home, name);

  if (!existsSync(dest)) throw new UserError(`Static site not found: ${name}`);

  if (!(await confirm(ctx, `Delete ${dest}?`))) {
    say.meta('Cancelled.');
    return;
  }

  // Written by this CLI as the invoking user, so no container is needed here.
  rmSync(dest, { recursive: true, force: true });
  rmSync(join(staticDir(ctx.home), '.sources', name), { force: true });
  forgetSource(ctx, name);

  say.ok(`Removed ${dest}`);
  say.meta("  Remove its vhost too:  devproxy remove -h DOMAIN");
}

export function staticList(ctx: Ctx): void {
  const sites = summarize(ctx);

  if (ctx.json) {
    emitJson({ home: ctx.home, root: staticDir(ctx.home), containerRoot: CONTAINER_ROOT, sites });
    return;
  }

  say.blank();
  console.log(
    `  ${color.brand(color.bold('Static Sites'))}  ${color.meta(`nginx/static/ → ${CONTAINER_ROOT}/`)}`,
  );
  say.blank();

  if (sites.length === 0) {
    say.meta('  None yet — add one with: pubservices static add <name> <source-dir>');
    say.blank();
    return;
  }

  for (const s of sites) {
    const size = s.bytes >= 1_048_576 ? `${(s.bytes / 1_048_576).toFixed(1)} MB` : `${(s.bytes / 1024).toFixed(0)} KB`;
    console.log(`  ${color.ok('●')} ${color.bold(s.name)}  ${color.meta(`${s.files} files, ${size}`)}`);
    say.meta(`    ${s.containerPath}`);
    if (s.source) say.meta(`    source  ${s.source}`);
    else say.meta('    source  not recorded — static update will skip it');
  }
  say.blank();
}

const OVERRIDE = 'docker-compose.override.yml';

/**
 * Option B from the docs: bind a host directory into nginx at the same path,
 * so `devproxy --static --root /home/you/project/dist` resolves inside the
 * container. Read-only, and easy to undo.
 */
export async function staticMount(ctx: Ctx, pathArg: string | undefined): Promise<void> {
  const file = join(ctx.home, OVERRIDE);
  const target = expand(pathArg ?? homedir());

  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new UserError(`Directory not found: ${target}`);
  }

  if (existsSync(file) && !(await confirm(ctx, `${OVERRIDE} already exists. Overwrite?`))) {
    say.meta('Cancelled.');
    return;
  }

  writeFileSync(
    file,
    [
      `# ${OVERRIDE}`,
      '# Generated by: pubservices static mount',
      `# Mounts ${target} into the nginx container at the same path (read-only),`,
      '# so devproxy --static --root can use real host paths.',
      'services:',
      '  nginx:',
      '    volumes:',
      `      - "${target}:${target}:ro"`,
      '',
    ].join('\n'),
  );

  say.blank();
  say.ok(`Created ${file}`);
  say.meta(`  ${target} → ${target} (read-only)`);
  say.blank();
  say.meta('  Restart nginx to apply:  pubservices up --proxy');
  say.meta('  Undo:                    pubservices static unmount');
  say.blank();
}

export async function staticUnmount(ctx: Ctx): Promise<void> {
  const file = join(ctx.home, OVERRIDE);

  if (!existsSync(file)) {
    say.warn(`${OVERRIDE} not found — nothing to remove.`);
    return;
  }

  if (!(await confirm(ctx, `Delete ${OVERRIDE} and the host mount?`))) {
    say.meta('Cancelled.');
    return;
  }

  rmSync(file, { force: true });
  say.ok(`Removed ${file}`);
  say.meta('  Restart nginx to apply:  pubservices up --proxy');
}
