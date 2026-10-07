import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Ctx, emitJson } from '../context.js';
import { type ProjectInfo, buildProject, detectProject } from '../detect.js';
import { run } from '../docker.js';
import { readState, updateState } from '../state.js';
import { confirm } from '../prompt.js';
import { ask } from '../prompt.js';
import { deploySsr, removeSsr, restartSsr } from './deploy.js';
import { UserError, color, say } from '../ui.js';

/* ------------------------------------------------------------------ */
/*  Constants & path helpers                                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Source tracking (backward-compatible with v1 .sources/ and v2     */
/*  staticSources, plus the new v2 staticSites format)                */
/* ------------------------------------------------------------------ */

/**
 * Source directories were kept in nginx/static/.sources/<name> by v1 and live
 * in state.json now. Read both so an upgraded installation keeps working, and
 * fold the old files into state on the way.
 */
function sources(ctx: Ctx): Record<string, string> {
  const state = readState(ctx.home);

  // staticSites takes precedence — extract sources from it.
  const fromSites: Record<string, string> = {};
  for (const [name, info] of Object.entries(state.staticSites)) {
    fromSites[name] = info.source;
  }

  const legacyDir = join(staticDir(ctx.home), '.sources');
  const fromLegacy: Record<string, string> = {};
  if (existsSync(legacyDir)) {
    for (const file of readdirSync(legacyDir)) {
      const value = readFileSync(join(legacyDir, file), 'utf8').trim();
      if (value) fromLegacy[file] = value;
    }
  }

  // Merge: staticSites > staticSources > legacy .sources/
  const merged = { ...fromLegacy, ...state.staticSources, ...fromSites };

  // Migrate legacy into state if anything was new.
  if (Object.keys(fromLegacy).length > 0) {
    const current = { ...state.staticSources };
    let changed = false;
    for (const [k, v] of Object.entries(fromLegacy)) {
      if (!current[k]) {
        current[k] = v;
        changed = true;
      }
    }
    if (changed) updateState(ctx.home, { staticSources: current });
  }

  return merged;
}

function rememberSource(ctx: Ctx, name: string, src: string, info?: ProjectInfo): void {
  const state = readState(ctx.home);

  // Always write to legacy staticSources for backward compat.
  const nextSources = { ...state.staticSources, [name]: src };

  // Write rich metadata to staticSites.
  const nextSites = { ...state.staticSites };
  if (info) {
    nextSites[name] = {
      source: src,
      type: info.type,
      deployMode: info.deployMode,
      outputMode: info.nextOutputMode ?? info.nuxtOutputMode,
      port: nextSites[name]?.port, // preserve port if already allocated
    };
  } else {
    // No detection info — plain static site.
    nextSites[name] = {
      source: src,
      type: 'static',
      deployMode: 'static',
    };
  }

  updateState(ctx.home, { staticSources: nextSources, staticSites: nextSites });
}

function forgetSource(ctx: Ctx, name: string): void {
  const state = readState(ctx.home);

  const nextSources = { ...state.staticSources };
  delete nextSources[name];

  const nextSites = { ...state.staticSites };
  delete nextSites[name];

  updateState(ctx.home, { staticSources: nextSources, staticSites: nextSites });
}

/* ------------------------------------------------------------------ */
/*  File sync (static deploy mode)                                    */
/* ------------------------------------------------------------------ */

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
    const res = await run('rsync', ['-a', '--checksum', '--delete', `${src}/`, `${dest}/`]);
    if (res.code !== 0) throw new UserError('rsync failed.', res.stderr.trim());
    return;
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/* ------------------------------------------------------------------ */
/*  Site summary (for list command)                                   */
/* ------------------------------------------------------------------ */

interface SiteSummary {
  name: string;
  path: string;
  containerPath: string;
  files: number;
  bytes: number;
  source: string | null;
  type: string;
  deployMode: string;
  outputMode: string | null;
  port: number | null;
}

function summarize(ctx: Ctx): SiteSummary[] {
  const state = readState(ctx.home);
  const saved = sources(ctx);
  const dir = staticDir(ctx.home);

  const results: SiteSummary[] = [];

  // Static sites (files in nginx/static/).
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      let files = 0;
      let bytes = 0;
      for (const child of readdirSync(path, { recursive: true, withFileTypes: true })) {
        if (!child.isFile()) continue;
        files += 1;
        bytes += statSync(join(child.parentPath, child.name)).size;
      }
      const siteInfo = state.staticSites[entry.name];
      results.push({
        name: entry.name,
        path,
        containerPath: `${CONTAINER_ROOT}/${entry.name}`,
        files,
        bytes,
        source: saved[entry.name] ?? null,
        type: siteInfo?.type ?? 'static',
        deployMode: siteInfo?.deployMode ?? 'static',
        outputMode: siteInfo?.outputMode ?? null,
        port: null,
      });
    }
  }

  // SSR sites (containers, not in nginx/static/).
  for (const [name, info] of Object.entries(state.staticSites)) {
    if (info.deployMode !== 'ssr') continue;
    // Skip if already listed as a static site directory.
    if (results.some((r) => r.name === name)) continue;
    results.push({
      name,
      path: '',
      containerPath: '',
      files: 0,
      bytes: 0,
      source: info.source,
      type: info.type,
      deployMode: 'ssr',
      outputMode: info.outputMode ?? null,
      port: info.port ?? null,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/*  Build option types                                                */
/* ------------------------------------------------------------------ */

export interface StaticAddOptions {
  /** Force a fresh build before deploying. */
  build?: boolean;
  /** Skip the build step even if output is missing. */
  noBuild?: boolean;
}

export interface StaticUpdateOptions {
  /** Rebuild the project before syncing / restarting. */
  build?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Commands                                                          */
/* ------------------------------------------------------------------ */

export async function staticAdd(
  ctx: Ctx,
  nameArg: string | undefined,
  srcArg: string | undefined,
  opts: StaticAddOptions = {},
): Promise<void> {
  const name = nameArg ?? (await ask(ctx, 'Site name', 'myapp'));
  assertName(name);

  const src = expand(srcArg ?? (await ask(ctx, 'Project or build output directory', '~/projects/myapp')));
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new UserError(`Directory not found: ${src}`);
  }

  // Detect the project type.
  const info = detectProject(src);

  if (info.type !== 'unknown' && info.type !== 'static') {
    say.step(`Detected ${color.bold(info.label)} project`);
  }

  // Handle build if needed.
  if (opts.build) {
    // Forced build.
    await buildProject(src, info);
  } else if (!info.outputExists && !opts.noBuild && info.type !== 'static' && info.type !== 'unknown') {
    // Output doesn't exist — ask to build.
    const shouldBuild = await confirm(
      ctx,
      `Build output not found (${info.outputDir}). Run ${info.label} build now?`,
      true,
    );
    if (shouldBuild) {
      await buildProject(src, info);
    } else {
      throw new UserError(
        'Build output directory does not exist.',
        `Build your project first, then re-run: pubservices static add ${name} ${src}`,
      );
    }
  }

  // Deploy based on mode.
  if (info.deployMode === 'ssr') {
    await deploySsr(ctx, name, src, info);
    // Also save to legacy staticSources for backward compat.
    const state = readState(ctx.home);
    const nextSources = { ...state.staticSources, [name]: src };
    updateState(ctx.home, { staticSources: nextSources });
    return;
  }

  // Static deploy mode — sync files to nginx/static/.
  const outputDir = (info.type === 'static' || info.type === 'unknown') ? src : info.outputDir;

  if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
    throw new UserError(`Build output directory not found: ${outputDir}`);
  }

  say.step(`Syncing into nginx/static/${name}...`);
  await sync(ctx.home, name, outputDir);
  rememberSource(ctx, name, src, info);

  say.blank();
  say.ok(`Synced to ${siteDir(ctx.home, name)}`);
  if (info.type !== 'static' && info.type !== 'unknown') {
    say.meta(`  framework       ${info.label}`);
  }
  say.meta(`  container path  ${CONTAINER_ROOT}/${name}`);
  const devproxyType =
    info.type === 'nextjs'
      ? 'nextjs'
      : info.type === 'nuxt'
        ? 'nuxt'
        : info.type === 'vite' || info.type === 'cra'
          ? 'spa'
          : 'static';
  const devproxyArgs = ['create', '-h', `${name}.local`, '--static', '--name', name, '--type', devproxyType];
  const devproxyCmd = `devproxy ${devproxyArgs.join(' ')}`;

  say.blank();
  say.meta('  Create local domain with devproxy:');
  console.log(`  ${color.brand(devproxyCmd)}`);
  say.meta(`  After each rebuild:  pubservices static update ${name}`);
  say.blank();

  const hasDevproxy = (await run('which', ['devproxy']).catch(() => null))?.code === 0;
  if (hasDevproxy && !ctx.yes && process.stdin.isTTY) {
    const shouldRun = await confirm(
      ctx,
      `Execute devproxy now to create domain http://${name}.local?`,
      true,
    );
    if (shouldRun) {
      say.step(`Running: ${devproxyCmd}`);
      await run('devproxy', devproxyArgs, { stdio: 'inherit' });
    }
  }
}

export async function staticUpdate(
  ctx: Ctx,
  nameArg: string | undefined,
  opts: StaticUpdateOptions = {},
): Promise<void> {
  const saved = sources(ctx);
  const state = readState(ctx.home);

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

    const siteInfo = state.staticSites[name];

    // Re-detect project to pick up config changes.
    const info = detectProject(src);

    // Build if requested.
    if (opts.build) {
      await buildProject(src, info);
    }

    if (siteInfo?.deployMode === 'ssr' || info.deployMode === 'ssr') {
      // SSR site — restart the container.
      await restartSsr(ctx, name);
      say.ok(`${name} ${color.meta('(SSR container restarted)')}`);
    } else {
      // Static site — re-sync files.
      const outputDir = (info.type === 'static' || info.type === 'unknown') ? src : info.outputDir;
      if (!existsSync(outputDir)) {
        throw new UserError(
          `Build output not found: ${outputDir}`,
          opts.build ? undefined : 'Add --build to rebuild first.',
        );
      }
      await sync(ctx.home, name, outputDir);
      rememberSource(ctx, name, src, info);
      say.ok(`${name} ${color.meta(`← ${src}`)}`);
    }
  }
}

export async function staticRemove(ctx: Ctx, nameArg: string | undefined): Promise<void> {
  const name = nameArg ?? (await ask(ctx, 'Site name to remove'));
  const state = readState(ctx.home);
  const siteInfo = state.staticSites[name];
  const dest = siteDir(ctx.home, name);
  const isStaticDir = existsSync(dest);
  const isSsr = siteInfo?.deployMode === 'ssr';

  if (!isStaticDir && !isSsr) throw new UserError(`Site not found: ${name}`);

  const label = isSsr ? `SSR container and state for ${name}` : dest;
  if (!(await confirm(ctx, `Delete ${label}?`))) {
    say.meta('Cancelled.');
    return;
  }

  // Clean up SSR container if applicable.
  if (isSsr) {
    await removeSsr(ctx, name);
  }

  // Remove static files if they exist.
  if (isStaticDir) {
    rmSync(dest, { recursive: true, force: true });
  }

  // Clean up legacy .sources/ file.
  rmSync(join(staticDir(ctx.home), '.sources', name), { force: true });

  forgetSource(ctx, name);

  say.ok(`Removed ${name}`);
  if (!isSsr) {
    say.meta("  Remove its vhost too:  devproxy remove -h DOMAIN");
  }
}

export function staticList(ctx: Ctx): void {
  const sites = summarize(ctx);

  if (ctx.json) {
    emitJson({
      home: ctx.home,
      root: staticDir(ctx.home),
      containerRoot: CONTAINER_ROOT,
      sites,
    });
    return;
  }

  say.blank();
  console.log(
    `  ${color.brand(color.bold('Static Sites'))}  ${color.meta(`nginx/static/ → ${CONTAINER_ROOT}/`)}`,
  );
  say.blank();

  if (sites.length === 0) {
    say.meta('  None yet — add one with: pubservices static add <name> <project-dir>');
    say.blank();
    return;
  }

  for (const s of sites) {
    if (s.deployMode === 'ssr') {
      // SSR site.
      const typeLabel = [s.type, s.outputMode].filter(Boolean).join('/');
      console.log(
        `  ${color.ok('●')} ${color.bold(s.name)}  ${color.meta(`SSR, port ${s.port}`)}  ${color.brand(typeLabel)}`,
      );
      say.meta(`    http://localhost:${s.port}`);
    } else {
      // Static site.
      const size =
        s.bytes >= 1_048_576
          ? `${(s.bytes / 1_048_576).toFixed(1)} MB`
          : `${(s.bytes / 1024).toFixed(0)} KB`;
      const typeLabel = s.type !== 'static' && s.type !== 'unknown'
        ? `  ${color.brand([s.type, s.outputMode].filter(Boolean).join('/'))}`
        : '';
      console.log(
        `  ${color.ok('●')} ${color.bold(s.name)}  ${color.meta(`${s.files} files, ${size}`)}${typeLabel}`,
      );
      say.meta(`    ${s.containerPath}`);
    }
    if (s.source) say.meta(`    source  ${s.source}`);
    else say.meta('    source  not recorded — static update will skip it');
  }
  say.blank();
}

/* ------------------------------------------------------------------ */
/*  Host-mount (unchanged)                                            */
/* ------------------------------------------------------------------ */

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
