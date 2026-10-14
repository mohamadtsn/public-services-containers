import { existsSync, cpSync } from 'node:fs';
import { isCancel, select, text } from '@clack/prompts';
import { type Ctx, emitJson } from '../context.js';
import {
  CUSTOM_COMPOSE_FILE,
  addCustomService,
  customComposeFile,
  loadCustomServices,
  removeCustomService,
} from '../custom.js';
import { inspectMany, run } from '../docker.js';
import { templatesDir } from '../home.js';
import { confirm } from '../prompt.js';
import { UserError, color, pad, say, symbol, tildify, width } from '../ui.js';

export const CUSTOM_PRESETS: Record<
  string,
  {
    label: string;
    image: string;
    ports: string[];
    volumes: string[];
    environment?: Record<string, string>;
  }
> = {
  mongodb: {
    label: 'MongoDB (mongo:7)',
    image: 'mongo:7',
    ports: ['27017:27017'],
    volumes: ['./data/mongodb:/data/db'],
    environment: {
      MONGO_INITDB_ROOT_USERNAME: 'root',
      MONGO_INITDB_ROOT_PASSWORD: 'password',
    },
  },
  rabbitmq: {
    label: 'RabbitMQ Management (rabbitmq:3-management)',
    image: 'rabbitmq:3-management',
    ports: ['5672:5672', '15672:15672'],
    volumes: ['./data/rabbitmq:/var/lib/rabbitmq'],
  },
  meilisearch: {
    label: 'Meilisearch (getmeili/meilisearch:latest)',
    image: 'getmeili/meilisearch:latest',
    ports: ['7700:7700'],
    volumes: ['./data/meilisearch:/meili_data'],
    environment: {
      MEILI_MASTER_KEY: 'masterKey123',
    },
  },
  clickhouse: {
    label: 'ClickHouse Server (clickhouse/clickhouse-server:latest)',
    image: 'clickhouse/clickhouse-server:latest',
    ports: ['8123:8123', '9000:9000'],
    volumes: ['./data/clickhouse:/var/lib/clickhouse'],
  },
};

export async function customListCommand(ctx: Ctx): Promise<void> {
  const file = customComposeFile(ctx.home);
  const services = loadCustomServices(ctx.home);
  const statuses = await inspectMany(services.map((s) => s.container));

  if (ctx.json) {
    emitJson({
      file,
      services: services.map((s) => ({
        ...s,
        status: statuses.get(s.container) ?? 'missing',
      })),
    });
    return;
  }

  say.blank();
  console.log(`  ${color.brand(color.bold('Custom Services'))}  ${color.meta(tildify(file))}`);
  say.blank();

  if (services.length === 0) {
    say.meta('  No custom services defined yet.');
    say.meta('  Add one using: pubservices custom add');
    say.meta('  Or edit the compose file: pubservices custom edit');
    say.blank();
    return;
  }

  const nameWidth = Math.max(8, ...services.map((s) => width(s.key)));
  const containerWidth = Math.max(12, ...services.map((s) => width(s.container)));

  for (const svc of services) {
    const status = statuses.get(svc.container) ?? 'missing';
    const isLive = status === 'healthy' || status === 'running';
    const mark = isLive ? color.ok(symbol.ok) : color.meta(symbol.off);
    const ports = svc.ports.length > 0 ? svc.ports.join(', ') : 'no ports';
    console.log(
      `  ${mark} ${color.bold(pad(svc.key, nameWidth))}  ${color.meta(pad(svc.container, containerWidth))}  ${color.meta(svc.image ?? '—')}  ${color.meta(`(${ports})`)}`,
    );
  }

  say.blank();
  say.meta('  Commands:');
  say.meta('    pubservices up <name>       start service');
  say.meta('    pubservices logs <name>     follow logs');
  say.meta('    pubservices custom add      add another service');
  say.meta('    pubservices custom edit     open compose file in $EDITOR');
  say.blank();
}

export async function customEditCommand(ctx: Ctx): Promise<void> {
  const file = customComposeFile(ctx.home);
  if (!existsSync(file)) {
    const example = customComposeFile(templatesDir());
    if (existsSync(example)) {
      cpSync(example, file);
    }
  }

  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  say.step(`Opening ${tildify(file)} in ${editor}...`);
  const res = await run(editor, [file], { stdio: 'inherit' });
  if (res.code !== 0) throw new UserError(`${editor} exited with ${res.code}.`);
  say.ok(`Saved ${tildify(file)}`);
  say.meta('  Restart affected services: pubservices restart');
}

export async function customAddCommand(ctx: Ctx, presetArg?: string): Promise<void> {
  const file = customComposeFile(ctx.home);

  let key = presetArg?.toLowerCase();
  let preset = key ? CUSTOM_PRESETS[key] : undefined;

  if (!preset && key && key !== 'custom') {
    throw new UserError(
      `Unknown preset: '${key}'`,
      `Available presets: ${Object.keys(CUSTOM_PRESETS).join(', ')}, or omit to choose interactively.`,
    );
  }

  if (!preset && !key) {
    if (!process.stdin.isTTY) {
      throw new UserError(
        'Interactive prompts require a TTY.',
        `Pass a preset directly: pubservices custom add <${Object.keys(CUSTOM_PRESETS).join('|')}>`,
      );
    }

    const choice = await select({
      message: 'Choose a custom service to add:',
      options: [
        ...Object.entries(CUSTOM_PRESETS).map(([k, p]) => ({
          value: k,
          label: p.label,
          hint: p.ports.join(', '),
        })),
        { value: 'custom', label: 'Custom (manual configuration)', hint: 'enter image, ports, volumes' },
      ],
    });

    if (isCancel(choice)) {
      say.meta('Cancelled.');
      return;
    }

    if (choice === 'custom') {
      const nameInput = await text({
        message: 'Service key (e.g. elasticsearch, keycloak):',
        validate: (val) => (!val || !val.trim() ? 'Name cannot be empty' : undefined),
      });
      if (isCancel(nameInput)) return;
      key = nameInput.trim().toLowerCase();

      const imageInput = await text({
        message: 'Docker image (e.g. elasticsearch:8.13.0):',
        validate: (val) => (!val || !val.trim() ? 'Image cannot be empty' : undefined),
      });
      if (isCancel(imageInput)) return;
      const image = imageInput.trim();

      const portInput = await text({
        message: 'Port mapping (e.g. 9200:9200, leave blank if none):',
      });
      if (isCancel(portInput)) return;
      const ports = portInput
        .trim()
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const volInput = await text({
        message: `Data directory (e.g. ./data/${key}, leave blank if none):`,
      });
      if (isCancel(volInput)) return;
      const volumes = volInput ? [volInput.trim()] : [];

      addCustomService(ctx.home, {
        key,
        image,
        containerName: `${key}-main`,
        ports,
        volumes,
      });

      say.blank();
      say.ok(`Added custom service '${color.bold(key)}' to ${tildify(file)}`);
      say.meta(`  Start it now with:  pubservices up ${key}`);
      say.meta(`  Or start all:       pubservices up`);
      say.blank();
      return;
    }

    key = choice as string;
    preset = CUSTOM_PRESETS[key];
  }

  if (preset && key) {
    addCustomService(ctx.home, {
      key,
      image: preset.image,
      containerName: `${key}-main`,
      ports: preset.ports,
      volumes: preset.volumes,
      environment: preset.environment,
    });

    say.blank();
    say.ok(`Added preset service '${color.bold(key)}' to ${tildify(file)}`);
    say.meta(`  Start it with:  pubservices up ${key}`);
    say.blank();
  }
}

export async function customRemoveCommand(ctx: Ctx, serviceKeyArg?: string): Promise<void> {
  const services = loadCustomServices(ctx.home);
  if (services.length === 0) {
    throw new UserError('No custom services defined in this installation.');
  }

  let key = serviceKeyArg;
  if (!key) {
    if (!process.stdin.isTTY) {
      throw new UserError('Pass the service name to remove: pubservices custom remove <name>');
    }

    const choice = await select({
      message: 'Which custom service do you want to remove?',
      options: services.map((s) => ({
        value: s.key,
        label: s.key,
        hint: s.image,
      })),
    });
    if (isCancel(choice)) return;
    key = choice as string;
  }

  if (!(await confirm(ctx, `Remove custom service '${key}' from ${CUSTOM_COMPOSE_FILE}?`))) {
    say.meta('Cancelled.');
    return;
  }

  const ok = removeCustomService(ctx.home, key);
  if (ok) {
    say.ok(`Removed '${key}' from ${CUSTOM_COMPOSE_FILE}.`);
    say.meta(`  If the container is still running, stop it with: docker rm -f ${key}-main`);
  } else {
    say.warn(`Service '${key}' not found in ${CUSTOM_COMPOSE_FILE}.`);
  }
}
