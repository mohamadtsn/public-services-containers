import { describe, expect, it } from 'vitest';
import { isNewer } from '../src/commands/update.js';

describe('version comparison', () => {
  it('orders release versions numerically, not lexically', () => {
    expect(isNewer('2.0.1', '2.0.0')).toBe(true);
    expect(isNewer('2.1.0', '2.0.9')).toBe(true);
    // The lexical trap: "10" < "9" as strings.
    expect(isNewer('2.0.10', '2.0.9')).toBe(true);
    expect(isNewer('2.0.0', '2.0.0')).toBe(false);
    expect(isNewer('1.9.9', '2.0.0')).toBe(false);
  });

  it('treats a release as newer than its own pre-releases', () => {
    expect(isNewer('2.0.0', '2.0.0-alpha.0')).toBe(true);
    expect(isNewer('2.0.0-alpha.0', '2.0.0')).toBe(false);
    expect(isNewer('2.0.0-beta.1', '2.0.0-alpha.9')).toBe(true);
  });

  it('tolerates a leading v', () => {
    expect(isNewer('v2.1.0', '2.0.0')).toBe(true);
  });
});
