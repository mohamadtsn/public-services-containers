import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './docker.js';
import { UserError, say } from './ui.js';

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export type FrameworkType = 'nextjs' | 'nuxt' | 'vite' | 'cra' | 'static' | 'unknown';
export type DeployMode = 'static' | 'ssr';
export type NextOutputMode = 'export' | 'standalone' | 'default';
export type NuxtOutputMode = 'generate' | 'server';
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface ProjectInfo {
  type: FrameworkType;
  deployMode: DeployMode;
  /** Absolute path to the build output directory. */
  outputDir: string;
  /** Whether the output directory already exists (a previous build ran). */
  outputExists: boolean;
  /** Human-readable label for UI messages. */
  label: string;
  /** Package manager detected from lockfiles. */
  packageManager: PackageManager;
  /** Next.js specific — which output mode is configured. */
  nextOutputMode?: NextOutputMode;
  /** Nuxt specific — static generate or SSR server. */
  nuxtOutputMode?: NuxtOutputMode;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const CONFIG_EXTENSIONS = ['js', 'mjs', 'ts'];

function findConfigFile(dir: string, baseName: string): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = join(dir, `${baseName}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasDependency(pkg: Record<string, unknown>, name: string): boolean {
  const deps = pkg.dependencies as Record<string, string> | undefined;
  const devDeps = pkg.devDependencies as Record<string, string> | undefined;
  return !!(deps?.[name] || devDeps?.[name]);
}

/* ------------------------------------------------------------------ */
/*  Config parsers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reads a Next.js config file and extracts the `output` value.
 * Uses a simple regex — no `require` / `import` to avoid executing user code.
 */
export function parseNextOutputMode(configPath: string): NextOutputMode {
  const content = readFileSync(configPath, 'utf8');
  const match = content.match(/output\s*[:=]\s*['"`](\w+)['"`]/);
  if (match) {
    if (match[1] === 'export') return 'export';
    if (match[1] === 'standalone') return 'standalone';
  }
  return 'default';
}

/**
 * Reads a Nuxt config file and determines whether the project is configured
 * for static generation or SSR.
 *
 * `ssr: false` or `target: 'static'` → generate (static).
 * Everything else → server (SSR).
 */
export function parseNuxtOutputMode(configPath: string): NuxtOutputMode {
  const content = readFileSync(configPath, 'utf8');
  if (/ssr\s*:\s*false/.test(content)) return 'generate';
  if (/target\s*:\s*['"`]static['"`]/.test(content)) return 'generate';
  return 'server';
}

/* ------------------------------------------------------------------ */
/*  Package manager detection                                         */
/* ------------------------------------------------------------------ */

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/* ------------------------------------------------------------------ */
/*  Main detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Inspects a directory and returns the detected framework, deploy mode,
 * and build output directory. Detection is ordered by specificity so the
 * first match wins.
 */
export function detectProject(dir: string): ProjectInfo {
  const pm = detectPackageManager(dir);
  const pkg = readPackageJson(dir);

  /* ---- Next.js ---- */
  const nextConfig = findConfigFile(dir, 'next.config');
  if (nextConfig) {
    const mode = parseNextOutputMode(nextConfig);
    const outputDir =
      mode === 'export'
        ? join(dir, 'out')
        : mode === 'standalone'
          ? join(dir, '.next', 'standalone')
          : join(dir, '.next');

    const labels: Record<NextOutputMode, string> = {
      export: 'Next.js (static export)',
      standalone: 'Next.js (standalone)',
      default: 'Next.js (SSR)',
    };

    return {
      type: 'nextjs',
      deployMode: mode === 'export' ? 'static' : 'ssr',
      outputDir,
      outputExists: existsSync(outputDir),
      label: labels[mode],
      packageManager: pm,
      nextOutputMode: mode,
    };
  }

  /* ---- Nuxt ---- */
  const nuxtConfig = findConfigFile(dir, 'nuxt.config');
  if (nuxtConfig) {
    const mode = parseNuxtOutputMode(nuxtConfig);
    const outputDir =
      mode === 'generate'
        ? join(dir, '.output', 'public')
        : join(dir, '.output');

    return {
      type: 'nuxt',
      deployMode: mode === 'generate' ? 'static' : 'ssr',
      outputDir,
      outputExists: existsSync(outputDir),
      label: mode === 'generate' ? 'Nuxt (static)' : 'Nuxt (SSR)',
      packageManager: pm,
      nuxtOutputMode: mode,
    };
  }

  /* ---- Vite ---- */
  if (findConfigFile(dir, 'vite.config')) {
    const outputDir = join(dir, 'dist');
    return {
      type: 'vite',
      deployMode: 'static',
      outputDir,
      outputExists: existsSync(outputDir),
      label: 'Vite',
      packageManager: pm,
    };
  }

  /* ---- Create React App ---- */
  if (pkg && hasDependency(pkg, 'react-scripts')) {
    const outputDir = join(dir, 'build');
    return {
      type: 'cra',
      deployMode: 'static',
      outputDir,
      outputExists: existsSync(outputDir),
      label: 'Create React App',
      packageManager: pm,
    };
  }

  /* ---- Plain static (no package.json, but has index.html) ---- */
  if (!pkg && existsSync(join(dir, 'index.html'))) {
    return {
      type: 'static',
      deployMode: 'static',
      outputDir: dir,
      outputExists: true,
      label: 'Static HTML',
      packageManager: pm,
    };
  }

  /* ---- Unknown — treat as a pre-built output directory ---- */
  return {
    type: 'unknown',
    deployMode: 'static',
    outputDir: dir,
    outputExists: existsSync(join(dir, 'index.html')),
    label: 'Unknown',
    packageManager: pm,
  };
}

/* ------------------------------------------------------------------ */
/*  Build runner                                                      */
/* ------------------------------------------------------------------ */

/**
 * Returns the build command for the given project.  Most frameworks define
 * a `build` script in package.json; Nuxt generate is the exception.
 */
function buildArgs(dir: string, info: ProjectInfo): { cmd: string; args: string[] } {
  const pm = info.packageManager;
  let script = 'build';

  if (info.type === 'nuxt' && info.nuxtOutputMode === 'generate') {
    const pkg = readPackageJson(dir);
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    if (scripts.generate) script = 'generate';
  }

  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['run', script] };
    case 'yarn':
      return { cmd: 'yarn', args: [script] };
    default:
      return { cmd: 'npm', args: ['run', script] };
  }
}

/** Runs the framework's build command with output streamed to the terminal. */
export async function buildProject(dir: string, info: ProjectInfo): Promise<void> {
  const { cmd, args } = buildArgs(dir, info);

  say.step(`Building ${info.label} project...`);
  const res = await run(cmd, args, { cwd: dir, stdio: 'inherit' });
  if (res.code !== 0) {
    throw new UserError(
      `Build failed (exit ${res.code}).`,
      `Run the build manually: ${cmd} ${args.join(' ')}`,
    );
  }

  // Refresh outputExists after a successful build.
  info.outputExists = existsSync(info.outputDir);
}
