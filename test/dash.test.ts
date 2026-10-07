import { describe, expect, it } from 'vitest';
import type { ContainerStatus } from '../src/docker.js';

/**
 * The dashboard indexes its colour and glyph tables by container status. A
 * status added to docker.ts without an entry here would render `undefined`
 * in a live view, so the tables are checked against the full union.
 */
const ALL: ContainerStatus[] = [
  'healthy',
  'running',
  'starting',
  'unhealthy',
  'stopped',
  'missing',
];

describe('dashboard status tables', () => {
  it('covers every container status', async () => {
    const { TONE, DOT } = await import('../src/dash.js');
    for (const status of ALL) {
      expect(TONE[status]).toBeTruthy();
      expect(DOT[status]).toBeTruthy();
    }
    expect(Object.keys(TONE).sort()).toEqual([...ALL].sort());
    expect(Object.keys(DOT).sort()).toEqual([...ALL].sort());
  });
});
