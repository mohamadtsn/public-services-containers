import { describe, expect, it } from 'vitest';
import { assertKnownService, profilesForAll, profilesForUp } from '../src/profiles.js';
import { UserError } from '../src/ui.js';

describe('profile resolution', () => {
  it('starts core services only when no profile is requested', () => {
    expect(profilesForUp({})).toEqual([]);
  });

  it('maps flags to compose profiles', () => {
    expect(profilesForUp({ proxy: true })).toEqual(['proxy']);
    expect(profilesForUp({ proxy: true, mail: true })).toEqual(['proxy', 'mail']);
    expect(profilesForUp({ postgres: true })).toEqual(['postgres']);
    expect(profilesForUp({ pgadmin: true })).toEqual(['pgadmin']);
    expect(profilesForUp({ full: true })).toEqual([
      'proxy',
      'pma',
      'mail',
      'storage',
      'postgres',
      'pgadmin',
    ]);
  });

  it('acts on every profile by default for down/restart/logs/build', () => {
    // Stopping "all services" must not leave the optional ones running.
    expect(profilesForAll({})).toEqual([
      'proxy',
      'pma',
      'mail',
      'storage',
      'postgres',
      'pgadmin',
    ]);
    expect(profilesForAll({ proxy: true })).toEqual(['proxy']);
  });

  it('rejects an unknown service before it reaches docker', () => {
    expect(() => assertKnownService('mysqll', ['mysql', 'redis'])).toThrow(UserError);
    expect(() => assertKnownService('mysql', ['mysql', 'redis'])).not.toThrow();
  });
});

describe('purgeDataDirs guards', () => {
  it('refuses a relative or root home', async () => {
    const { purgeDataDirs } = await import('../src/docker.js');
    await expect(purgeDataDirs('relative/path', ['mysql'])).rejects.toThrow(UserError);
    await expect(purgeDataDirs('/', ['mysql'])).rejects.toThrow(UserError);
  });

  it('refuses names that would escape data/', async () => {
    const { purgeDataDirs } = await import('../src/docker.js');
    await expect(purgeDataDirs('/tmp/whatever', ['../..'])).rejects.toThrow(UserError);
    await expect(purgeDataDirs('/tmp/whatever', ['mysql/../..'])).rejects.toThrow(UserError);
    await expect(purgeDataDirs('/tmp/whatever', [])).rejects.toThrow(UserError);
  });
});
