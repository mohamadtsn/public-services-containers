import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Env, type ServiceInfo, services } from './env.js';

export const CUSTOM_COMPOSE_FILE = 'docker-compose.custom.yml';
export const OVERRIDE_COMPOSE_FILE = 'docker-compose.override.yml';

export interface CustomServiceInfo {
  key: string;
  label: string;
  container: string;
  image?: string;
  ports: string[];
  isCustom: true;
}

export function customComposeFile(home: string): string {
  return join(home, CUSTOM_COMPOSE_FILE);
}

export function customComposeExists(home: string): boolean {
  return existsSync(customComposeFile(home));
}

/**
 * Returns all recognized service keys, combining built-in services and custom services.
 */
export function allServiceKeys(env: Env, home: string): string[] {
  const builtIn = services(env).map((s) => s.key);
  const custom = loadCustomServices(home).map((s) => s.key);
  return [...builtIn, ...custom];
}

/**
 * Returns all service infos, combining built-in services and custom services.
 */
export function allServices(env: Env, home: string): ServiceInfo[] {
  const builtIn = services(env);
  const custom = loadCustomServices(home).map((cs) => {
    const address = cs.ports.length > 0 ? cs.ports.map((p) => `:${p.split(':')[0]}`).join(', ') : '—';
    return {
      key: cs.key,
      label: cs.label,
      container: cs.container,
      profile: null,
      address,
    };
  });
  return [...builtIn, ...custom];
}

/**
 * Returns Docker Compose file arguments `-f <file>` in priority order:
 * 1. Base `docker-compose.yml`
 * 2. User-defined `docker-compose.custom.yml` (if present)
 * 3. Ephemeral host-mount `docker-compose.override.yml` (if present)
 */
export function composeFiles(home: string): string[] {
  const args = ['-f', 'docker-compose.yml'];
  if (existsSync(join(home, CUSTOM_COMPOSE_FILE))) {
    args.push('-f', CUSTOM_COMPOSE_FILE);
  }
  if (existsSync(join(home, OVERRIDE_COMPOSE_FILE))) {
    args.push('-f', OVERRIDE_COMPOSE_FILE);
  }
  return args;
}

/**
 * Extracts custom services defined under `services:` in `docker-compose.custom.yml`.
 */
export function loadCustomServices(home: string): CustomServiceInfo[] {
  const file = customComposeFile(home);
  if (!existsSync(file)) return [];

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  let inServices = false;
  let currentKey = '';
  let currentImage: string | undefined;
  let currentContainer: string | undefined;
  let currentPorts: string[] = [];
  let inPorts = false;

  const services: CustomServiceInfo[] = [];

  const flush = () => {
    if (currentKey) {
      services.push({
        key: currentKey,
        label: `${currentKey} [custom]`,
        container: currentContainer || `${currentKey}-main`,
        image: currentImage,
        ports: [...currentPorts],
        isCustom: true,
      });
    }
    currentKey = '';
    currentImage = undefined;
    currentContainer = undefined;
    currentPorts = [];
    inPorts = false;
  };

  for (const rawLine of lines) {
    // Top-level sections (e.g. services:, networks:, volumes:)
    if (/^[a-zA-Z0-9_-]+:\s*$/.test(rawLine)) {
      if (rawLine.startsWith('services:')) {
        inServices = true;
      } else {
        flush();
        inServices = false;
      }
      continue;
    }

    if (!inServices) continue;

    // Service key indented by exactly 2 spaces: "  myservice:"
    const serviceMatch = rawLine.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (serviceMatch) {
      flush();
      currentKey = serviceMatch[1]!;
      continue;
    }

    if (!currentKey) continue;

    // Inside service definition (4 or more spaces indentation)
    if (/^ {4}ports:\s*$/.test(rawLine)) {
      inPorts = true;
      continue;
    }

    if (inPorts) {
      const portItemMatch = rawLine.match(/^ {6}-\s*["']?([^"'\s]+)["']?\s*$/);
      if (portItemMatch) {
        currentPorts.push(portItemMatch[1]!);
        continue;
      } else if (!/^ {6}/.test(rawLine)) {
        inPorts = false;
      }
    }

    const imageMatch = rawLine.match(/^ {4}image:\s*["']?([^"'\s]+)["']?\s*$/);
    if (imageMatch) {
      currentImage = imageMatch[1]!;
      continue;
    }

    const containerMatch = rawLine.match(/^ {4}container_name:\s*["']?([^"'\s]+)["']?\s*$/);
    if (containerMatch) {
      currentContainer = containerMatch[1]!;
      continue;
    }
  }

  flush();
  return services;
}

export interface AddCustomServiceOptions {
  key: string;
  image: string;
  containerName?: string;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  command?: string;
}

/**
 * Appends or updates a custom service in `docker-compose.custom.yml`.
 */
export function addCustomService(home: string, opts: AddCustomServiceOptions): void {
  const file = customComposeFile(home);
  const containerName = opts.containerName || `${opts.key}-main`;
  const existingServices = loadCustomServices(home);

  if (existingServices.some((s) => s.key === opts.key)) {
    removeCustomService(home, opts.key);
  }

  const serviceYamlLines: string[] = [
    `  ${opts.key}:`,
    `    image: '${opts.image}'`,
    `    container_name: ${containerName}`,
    '    restart: unless-stopped',
  ];

  if (opts.command) {
    serviceYamlLines.push(`    command: ${opts.command}`);
  }

  if (opts.ports && opts.ports.length > 0) {
    serviceYamlLines.push('    ports:');
    for (const p of opts.ports) {
      serviceYamlLines.push(`      - '${p}'`);
    }
  }

  if (opts.environment && Object.keys(opts.environment).length > 0) {
    serviceYamlLines.push('    environment:');
    for (const [k, v] of Object.entries(opts.environment)) {
      serviceYamlLines.push(`      ${k}: '${v}'`);
    }
  }

  if (opts.volumes && opts.volumes.length > 0) {
    serviceYamlLines.push('    volumes:');
    for (const v of opts.volumes) {
      serviceYamlLines.push(`      - '${v}'`);
    }
  }

  serviceYamlLines.push('    networks:');
  serviceYamlLines.push('      - public-service-network');

  if (!existsSync(file)) {
    const header = [
      '# docker-compose.custom.yml',
      '# User-defined custom services for pubservices.',
      '# This file is preserved across pubservices upgrades.',
      '# Edit with: pubservices custom edit',
      '',
      'services:',
      ...serviceYamlLines,
      '',
      'networks:',
      '  public-service-network:',
      '    external: true',
      '',
    ].join('\n');
    writeFileSync(file, header, 'utf8');
    return;
  }

  // File exists: insert into services block
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  const servicesIdx = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (servicesIdx === -1) {
    lines.unshift('services:');
    lines.splice(1, 0, ...serviceYamlLines);
  } else {
    // Find end of services block (next top-level section or end of file)
    let insertIdx = lines.length;
    for (let i = servicesIdx + 1; i < lines.length; i++) {
      if (/^[a-zA-Z0-9_-]+:\s*$/.test(lines[i]!)) {
        insertIdx = i;
        break;
      }
    }
    lines.splice(insertIdx, 0, ...serviceYamlLines);
  }

  // Ensure networks definition exists at bottom if not present
  if (!lines.some((l) => /^networks:\s*$/.test(l))) {
    lines.push('', 'networks:', '  public-service-network:', '    external: true');
  }

  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

/**
 * Removes a service from `docker-compose.custom.yml`.
 * Returns true if removed, false if not found.
 */
export function removeCustomService(home: string, key: string): boolean {
  const file = customComposeFile(home);
  if (!existsSync(file)) return false;

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  let inServices = false;
  let serviceStart = -1;
  let serviceEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^[a-zA-Z0-9_-]+:\s*$/.test(line)) {
      if (line.startsWith('services:')) {
        inServices = true;
      } else {
        if (serviceStart !== -1) {
          serviceEnd = i;
          break;
        }
        inServices = false;
      }
      continue;
    }

    if (!inServices) continue;

    if (new RegExp(`^ {2}${key}:\\s*$`).test(line)) {
      serviceStart = i;
      continue;
    }

    if (serviceStart !== -1 && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)) {
      serviceEnd = i;
      break;
    }
  }

  if (serviceStart === -1) return false;
  if (serviceEnd === -1) serviceEnd = lines.length;

  lines.splice(serviceStart, serviceEnd - serviceStart);
  writeFileSync(file, lines.join('\n'), 'utf8');
  return true;
}
