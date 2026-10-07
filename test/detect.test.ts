import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  detectProject,
  parseNextOutputMode,
  parseNuxtOutputMode,
} from '../src/detect.js';

describe('detectProject', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-detect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------------ */
  /*  Next.js detection                                                  */
  /* ------------------------------------------------------------------ */

  describe('Next.js', () => {
    it('detects static export via next.config.js with output: "export"', () => {
      writeFileSync(
        join(dir, 'next.config.js'),
        `module.exports = { output: 'export' };`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('nextjs');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(join(dir, 'out'));
      expect(info.nextOutputMode).toBe('export');
      expect(info.label).toBe('Next.js (static export)');
    });

    it('detects standalone via next.config.mjs with output: "standalone"', () => {
      writeFileSync(
        join(dir, 'next.config.mjs'),
        `export default { output: 'standalone' };`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('nextjs');
      expect(info.deployMode).toBe('ssr');
      expect(info.outputDir).toBe(join(dir, '.next', 'standalone'));
      expect(info.nextOutputMode).toBe('standalone');
      expect(info.label).toBe('Next.js (standalone)');
    });

    it('defaults to SSR when next.config.ts has no output field', () => {
      writeFileSync(
        join(dir, 'next.config.ts'),
        `const config = { reactStrictMode: true };\nexport default config;`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('nextjs');
      expect(info.deployMode).toBe('ssr');
      expect(info.outputDir).toBe(join(dir, '.next'));
      expect(info.nextOutputMode).toBe('default');
      expect(info.label).toBe('Next.js (SSR)');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Nuxt detection                                                     */
  /* ------------------------------------------------------------------ */

  describe('Nuxt', () => {
    it('detects static mode via nuxt.config.ts with ssr: false', () => {
      writeFileSync(
        join(dir, 'nuxt.config.ts'),
        `export default defineNuxtConfig({ ssr: false });`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('nuxt');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(join(dir, '.output', 'public'));
      expect(info.nuxtOutputMode).toBe('generate');
      expect(info.label).toBe('Nuxt (static)');
    });

    it('defaults to SSR when nuxt.config.ts has no ssr or target field', () => {
      writeFileSync(
        join(dir, 'nuxt.config.ts'),
        `export default defineNuxtConfig({});`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('nuxt');
      expect(info.deployMode).toBe('ssr');
      expect(info.outputDir).toBe(join(dir, '.output'));
      expect(info.nuxtOutputMode).toBe('server');
      expect(info.label).toBe('Nuxt (SSR)');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Vite detection                                                     */
  /* ------------------------------------------------------------------ */

  describe('Vite', () => {
    it('detects vite.config.ts as static with dist/ output', () => {
      writeFileSync(
        join(dir, 'vite.config.ts'),
        `import { defineConfig } from 'vite';\nexport default defineConfig({});`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('vite');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(join(dir, 'dist'));
      expect(info.label).toBe('Vite');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Create React App detection                                         */
  /* ------------------------------------------------------------------ */

  describe('CRA', () => {
    it('detects react-scripts dependency as CRA with build/ output', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { 'react-scripts': '5.0.1' } }),
      );

      const info = detectProject(dir);

      expect(info.type).toBe('cra');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(join(dir, 'build'));
      expect(info.label).toBe('Create React App');
    });

    it('detects react-scripts in devDependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { 'react-scripts': '5.0.1' } }),
      );

      const info = detectProject(dir);

      expect(info.type).toBe('cra');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Plain static detection                                             */
  /* ------------------------------------------------------------------ */

  describe('Plain static', () => {
    it('detects index.html without package.json as static', () => {
      writeFileSync(join(dir, 'index.html'), '<h1>Hello</h1>');

      const info = detectProject(dir);

      expect(info.type).toBe('static');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(dir);
      expect(info.outputExists).toBe(true);
      expect(info.label).toBe('Static HTML');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Unknown project                                                    */
  /* ------------------------------------------------------------------ */

  describe('Unknown', () => {
    it('returns unknown when only package.json is present with no framework', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'foo', dependencies: { lodash: '4.0.0' } }),
      );

      const info = detectProject(dir);

      expect(info.type).toBe('unknown');
      expect(info.deployMode).toBe('static');
      expect(info.outputDir).toBe(dir);
      expect(info.label).toBe('Unknown');
    });

    it('reports outputExists=false when no index.html is present', () => {
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('unknown');
      expect(info.outputExists).toBe(false);
    });

    it('reports outputExists=true when index.html is present alongside package.json', () => {
      writeFileSync(join(dir, 'package.json'), '{}');
      writeFileSync(join(dir, 'index.html'), '<h1>Hi</h1>');

      const info = detectProject(dir);

      expect(info.type).toBe('unknown');
      expect(info.outputExists).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Output exists detection                                            */
  /* ------------------------------------------------------------------ */

  describe('outputExists', () => {
    it('is true when the output directory already exists', () => {
      writeFileSync(
        join(dir, 'vite.config.js'),
        `export default {};`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');
      mkdirSync(join(dir, 'dist'), { recursive: true });

      const info = detectProject(dir);

      expect(info.type).toBe('vite');
      expect(info.outputExists).toBe(true);
    });

    it('is false when the output directory does not exist', () => {
      writeFileSync(
        join(dir, 'vite.config.js'),
        `export default {};`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.type).toBe('vite');
      expect(info.outputExists).toBe(false);
    });

    it('is true for Next.js standalone when .next/standalone exists', () => {
      writeFileSync(
        join(dir, 'next.config.js'),
        `module.exports = { output: 'standalone' };`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');
      mkdirSync(join(dir, '.next', 'standalone'), { recursive: true });

      const info = detectProject(dir);

      expect(info.outputExists).toBe(true);
    });

    it('is false for Next.js export when out/ does not exist', () => {
      writeFileSync(
        join(dir, 'next.config.js'),
        `module.exports = { output: 'export' };`,
      );
      writeFileSync(join(dir, 'package.json'), '{}');

      const info = detectProject(dir);

      expect(info.outputExists).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Package manager detection                                          */
/* ------------------------------------------------------------------ */

describe('detectPackageManager', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-pm-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns pnpm when pnpm-lock.yaml exists', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('returns yarn when yarn.lock exists', () => {
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('returns npm when package-lock.json exists', () => {
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('returns npm as fallback when no lockfile exists', () => {
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('prefers pnpm over yarn when both lockfiles exist', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('sets packageManager on detected projects', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'vite.config.ts'), `export default {};`);
    writeFileSync(join(dir, 'package.json'), '{}');

    const info = detectProject(dir);
    expect(info.packageManager).toBe('pnpm');
  });
});

/* ------------------------------------------------------------------ */
/*  Next.js config parsing edge cases                                  */
/* ------------------------------------------------------------------ */

describe('parseNextOutputMode', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-nextcfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (content: string): string => {
    const p = join(dir, 'next.config.js');
    writeFileSync(p, content);
    return p;
  };

  it('parses ES module export default with output: "export"', () => {
    const p = write(`export default { output: "export" };`);
    expect(parseNextOutputMode(p)).toBe('export');
  });

  it('parses CommonJS module.exports with output: "standalone"', () => {
    const p = write(`module.exports = { output: 'standalone' };`);
    expect(parseNextOutputMode(p)).toBe('standalone');
  });

  it('handles output with double quotes', () => {
    const p = write(`module.exports = { output: "export" };`);
    expect(parseNextOutputMode(p)).toBe('export');
  });

  it('handles output with template literal backtick quotes', () => {
    const p = write('module.exports = { output: `standalone` };');
    expect(parseNextOutputMode(p)).toBe('standalone');
  });

  it('handles whitespace variations around the colon', () => {
    const p = write(`module.exports = { output   :   'export' };`);
    expect(parseNextOutputMode(p)).toBe('export');
  });

  it('handles whitespace variations around the equals sign', () => {
    const p = write(`const config = { output  =  'standalone' };`);
    expect(parseNextOutputMode(p)).toBe('standalone');
  });

  it('returns default when output is not specified', () => {
    const p = write(`module.exports = { reactStrictMode: true };`);
    expect(parseNextOutputMode(p)).toBe('default');
  });

  it('returns default for an empty config file', () => {
    const p = write('');
    expect(parseNextOutputMode(p)).toBe('default');
  });

  it('returns default when output value is unrecognized', () => {
    const p = write(`module.exports = { output: 'hybrid' };`);
    expect(parseNextOutputMode(p)).toBe('default');
  });

  it('handles multi-line config', () => {
    const p = write(`
      /** @type {import('next').NextConfig} */
      const nextConfig = {
        reactStrictMode: true,
        output: 'export',
        images: { unoptimized: true },
      };
      module.exports = nextConfig;
    `);
    expect(parseNextOutputMode(p)).toBe('export');
  });
});

/* ------------------------------------------------------------------ */
/*  Nuxt config parsing                                                */
/* ------------------------------------------------------------------ */

describe('parseNuxtOutputMode', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-nuxtcfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (content: string): string => {
    const p = join(dir, 'nuxt.config.ts');
    writeFileSync(p, content);
    return p;
  };

  it('returns generate when ssr: false is present', () => {
    const p = write(`export default defineNuxtConfig({ ssr: false });`);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('returns generate when target: "static" is present', () => {
    const p = write(`export default defineNuxtConfig({ target: 'static' });`);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('returns generate when target uses double quotes', () => {
    const p = write(`export default defineNuxtConfig({ target: "static" });`);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('returns generate when target uses backtick quotes', () => {
    const p = write('export default defineNuxtConfig({ target: `static` });');
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('returns server when no ssr or target fields are present', () => {
    const p = write(`export default defineNuxtConfig({});`);
    expect(parseNuxtOutputMode(p)).toBe('server');
  });

  it('returns server when ssr is true', () => {
    const p = write(`export default defineNuxtConfig({ ssr: true });`);
    expect(parseNuxtOutputMode(p)).toBe('server');
  });

  it('prefers ssr: false over missing target', () => {
    const p = write(`export default defineNuxtConfig({ ssr: false, devtools: { enabled: true } });`);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('handles multi-line config', () => {
    const p = write(`
      export default defineNuxtConfig({
        devtools: { enabled: true },
        ssr: false,
        modules: ['@nuxtjs/tailwindcss'],
      });
    `);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });

  it('handles whitespace around ssr: false', () => {
    const p = write(`export default defineNuxtConfig({ ssr :  false });`);
    expect(parseNuxtOutputMode(p)).toBe('generate');
  });
});
