import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CUSTOM_COMPOSE_FILE,
  addCustomService,
  allServiceKeys,
  allServices,
  composeFiles,
  customComposeFile,
  loadCustomServices,
  removeCustomService,
} from '../src/custom.js';
import { customAddCommand, customListCommand, customRemoveCommand } from '../src/commands/custom.js';
import { loadEnv } from '../src/env.js';

describe('custom services', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pubservices-custom-'));
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  mysql:\n    image: mysql:8.0\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty array when custom compose file does not exist', () => {
    expect(loadCustomServices(dir)).toEqual([]);
  });

  it('returns default compose file when no custom or override files exist', () => {
    expect(composeFiles(dir)).toEqual(['-f', 'docker-compose.yml']);
  });

  it('includes custom compose file in composeFiles when present', () => {
    writeFileSync(join(dir, CUSTOM_COMPOSE_FILE), 'services:\n  mongodb:\n    image: mongo:7\n');
    expect(composeFiles(dir)).toEqual(['-f', 'docker-compose.yml', '-f', CUSTOM_COMPOSE_FILE]);
  });

  it('includes override compose file after custom file when both present', () => {
    writeFileSync(join(dir, CUSTOM_COMPOSE_FILE), 'services:\n  mongodb:\n    image: mongo:7\n');
    writeFileSync(join(dir, 'docker-compose.override.yml'), 'services:\n  nginx:\n    volumes: []\n');
    expect(composeFiles(dir)).toEqual([
      '-f',
      'docker-compose.yml',
      '-f',
      CUSTOM_COMPOSE_FILE,
      '-f',
      'docker-compose.override.yml',
    ]);
  });

  it('parses services, containers, images, and ports from custom compose file', () => {
    const yaml = [
      'services:',
      '  mongodb:',
      '    image: mongo:7',
      '    container_name: custom-mongodb',
      '    ports:',
      '      - "27017:27017"',
      '    networks:',
      '      - public-service-network',
      '  rabbitmq:',
      '    image: rabbitmq:3-management',
      '    container_name: custom-rabbitmq',
      '    ports:',
      '      - "5672:5672"',
      '      - "15672:15672"',
      '    networks:',
      '      - public-service-network',
    ].join('\n');

    writeFileSync(join(dir, CUSTOM_COMPOSE_FILE), yaml);
    const services = loadCustomServices(dir);

    expect(services).toHaveLength(2);
    expect(services[0]).toEqual({
      key: 'mongodb',
      label: 'mongodb [custom]',
      container: 'custom-mongodb',
      image: 'mongo:7',
      ports: ['27017:27017'],
      isCustom: true,
    });
    expect(services[1]).toEqual({
      key: 'rabbitmq',
      label: 'rabbitmq [custom]',
      container: 'custom-rabbitmq',
      image: 'rabbitmq:3-management',
      ports: ['5672:5672', '15672:15672'],
      isCustom: true,
    });
  });

  it('adds a service to custom compose file and preserves existing structure', () => {
    addCustomService(dir, {
      key: 'mongodb',
      image: 'mongo:7',
      containerName: 'custom-mongo',
      ports: ['27017:27017'],
      volumes: ['./data/mongodb:/data/db'],
    });

    expect(existsSync(customComposeFile(dir))).toBe(true);
    const services = loadCustomServices(dir);
    expect(services).toHaveLength(1);
    expect(services[0]!.key).toBe('mongodb');
    expect(services[0]!.ports).toEqual(['27017:27017']);

    // Add another service
    addCustomService(dir, {
      key: 'meilisearch',
      image: 'getmeili/meilisearch:latest',
      containerName: 'custom-meili',
      ports: ['7700:7700'],
      volumes: ['./data/meilisearch:/meili_data'],
    });

    const updated = loadCustomServices(dir);
    expect(updated).toHaveLength(2);
    expect(updated.map((s) => s.key)).toEqual(['mongodb', 'meilisearch']);
  });

  it('removes a service from custom compose file', () => {
    addCustomService(dir, {
      key: 'mongodb',
      image: 'mongo:7',
      containerName: 'custom-mongo',
      ports: ['27017:27017'],
      volumes: ['./data/mongodb:/data/db'],
    });
    addCustomService(dir, {
      key: 'rabbitmq',
      image: 'rabbitmq:3-management',
      containerName: 'custom-rabbit',
      ports: ['5672:5672'],
      volumes: [],
    });

    expect(loadCustomServices(dir)).toHaveLength(2);

    const removed = removeCustomService(dir, 'mongodb');
    expect(removed).toBe(true);

    const remaining = loadCustomServices(dir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.key).toBe('rabbitmq');
  });

  it('combines built-in services and custom services in allServiceKeys', () => {
    addCustomService(dir, {
      key: 'mongodb',
      image: 'mongo:7',
      containerName: 'custom-mongo',
      ports: ['27017:27017'],
      volumes: [],
    });

    const env = loadEnv(dir);
    const keys = allServiceKeys(env, dir);
    expect(keys).toContain('mysql');
    expect(keys).toContain('postgres');
    expect(keys).toContain('mongodb');
  });

  it('combines built-in services and custom services in allServices', () => {
    addCustomService(dir, {
      key: 'mongodb',
      image: 'mongo:7',
      containerName: 'custom-mongo',
      ports: ['27017:27017'],
      volumes: [],
    });

    const env = loadEnv(dir);
    const list = allServices(env, dir);
    const mongo = list.find((s) => s.key === 'mongodb');
    expect(mongo).toBeDefined();
    expect(mongo!.label).toBe('mongodb [custom]');
    expect(mongo!.container).toBe('custom-mongo');
    expect(mongo!.address).toBe(':27017');
  });

  it('customAddCommand adds preset without interactive prompt', async () => {
    const ctx = {
      home: dir,
      env: loadEnv(dir),
      json: false,
      yes: true,
      created: false,
    };

    await customAddCommand(ctx, 'rabbitmq');
    const services = loadCustomServices(dir);
    expect(services).toHaveLength(1);
    expect(services[0]!.key).toBe('rabbitmq');
    expect(services[0]!.ports).toContain('5672:5672');
  });

  it('customRemoveCommand removes service with yes flag', async () => {
    const ctx = {
      home: dir,
      env: loadEnv(dir),
      json: false,
      yes: true,
      created: false,
    };

    await customAddCommand(ctx, 'mongodb');
    expect(loadCustomServices(dir)).toHaveLength(1);

    await customRemoveCommand(ctx, 'mongodb');
    expect(loadCustomServices(dir)).toHaveLength(0);
  });

  it('customListCommand executes cleanly in json mode', async () => {
    const ctx = {
      home: dir,
      env: loadEnv(dir),
      json: true,
      yes: true,
      created: false,
    };

    await customAddCommand(ctx, 'meilisearch');
    await expect(customListCommand(ctx)).resolves.toBeUndefined();
  });
});


