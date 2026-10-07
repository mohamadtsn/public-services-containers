import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // The Ink dashboard is dynamically imported, and splitting keeps it in its own
  // chunk so plain `pubservices status` never parses React.
  splitting: true,
  minify: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
});
