import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

/**
 * Defaults mirror docker-compose.yml. Container and network names are contracts
 * with local-dev-proxy and every dependent project — do not change them here.
 */
const DEFAULTS = {
  MYSQL_CONTAINER_NAME: 'mysql-main',
  REDIS_CONTAINER_NAME: 'redis-main',
  POSTGRES_CONTAINER_NAME: 'postgres-main',
  NGINX_CONTAINER_NAME: 'nginx-main',
  PMA_CONTAINER_NAME: 'phpmyadmin',
  PGADMIN_CONTAINER_NAME: 'pgadmin',
  MAILPIT_CONTAINER_NAME: 'mailpit',
  MINIO_CONTAINER_NAME: 'minio',
  NETWORK_NAME: 'public-service-network',

  MYSQL_DATABASE: 'main',
  MYSQL_USER: 'main_user',
  MYSQL_PASSWORD: 'password',
  MYSQL_ROOT_PASSWORD: 'root',
  MYSQL_PORT: '43306',
  REDIS_PORT: '46379',
  POSTGRES_DB: 'main',
  POSTGRES_USER: 'main_user',
  POSTGRES_PASSWORD: 'password',
  POSTGRES_PORT: '45432',
  NGINX_HTTP_PORT: '80',
  NGINX_HTTPS_PORT: '443',
  PMA_PORT: '18080',
  PGADMIN_PORT: '18081',
  PGADMIN_DEFAULT_EMAIL: 'admin@local.dev',
  PGADMIN_DEFAULT_PASSWORD: 'admin',
  MAILPIT_SMTP_PORT: '1025',
  MAILPIT_HTTP_PORT: '8025',
  MINIO_API_PORT: '9000',
  MINIO_CONSOLE_PORT: '9001',
  MINIO_ROOT_USER: 'minioadmin',
  MINIO_ROOT_PASSWORD: 'minioadmin',
} as const;

export type EnvKey = keyof typeof DEFAULTS;
export type Env = Record<EnvKey, string> & Record<string, string>;

/** Reads $PUBSERVICES_HOME/.env and fills in the compose defaults. */
export function loadEnv(home: string): Env {
  const file = join(home, '.env');
  const parsed = existsSync(file) ? parse(readFileSync(file)) : {};
  const out: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of Object.entries(parsed)) if (v !== '') out[k] = v;
  return out as Env;
}

export interface ServiceInfo {
  /** compose service key */
  key: string;
  label: string;
  container: string;
  /** compose profile, or null for core services that always run */
  profile: string | null;
  address: string;
}

export function services(env: Env): ServiceInfo[] {
  return [
    {
      key: 'mysql',
      label: 'MySQL',
      container: env.MYSQL_CONTAINER_NAME,
      profile: null,
      address: `localhost:${env.MYSQL_PORT}`,
    },
    {
      key: 'redis',
      label: 'Redis',
      container: env.REDIS_CONTAINER_NAME,
      profile: null,
      address: `localhost:${env.REDIS_PORT}`,
    },
    {
      key: 'postgres',
      label: 'PostgreSQL',
      container: env.POSTGRES_CONTAINER_NAME,
      profile: 'postgres',
      address: `localhost:${env.POSTGRES_PORT}`,
    },
    {
      key: 'nginx',
      label: 'Nginx',
      container: env.NGINX_CONTAINER_NAME,
      profile: 'proxy',
      address: `:${env.NGINX_HTTP_PORT} / :${env.NGINX_HTTPS_PORT}`,
    },
    {
      key: 'phpmyadmin',
      label: 'phpMyAdmin',
      container: env.PMA_CONTAINER_NAME,
      profile: 'pma',
      address: `http://localhost:${env.PMA_PORT}`,
    },
    {
      key: 'pgadmin',
      label: 'pgAdmin',
      container: env.PGADMIN_CONTAINER_NAME,
      profile: 'pgadmin',
      address: `http://localhost:${env.PGADMIN_PORT}`,
    },
    {
      key: 'mailpit',
      label: 'Mailpit',
      container: env.MAILPIT_CONTAINER_NAME,
      profile: 'mail',
      address: `http://localhost:${env.MAILPIT_HTTP_PORT}`,
    },
    {
      key: 'minio',
      label: 'MinIO',
      container: env.MINIO_CONTAINER_NAME,
      profile: 'storage',
      address: `:${env.MINIO_CONSOLE_PORT} (API :${env.MINIO_API_PORT})`,
    },
  ];
}

export const ALL_PROFILES = [
  'proxy',
  'pma',
  'mail',
  'storage',
  'postgres',
  'pgadmin',
] as const;
