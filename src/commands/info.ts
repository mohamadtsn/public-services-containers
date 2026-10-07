import { type Ctx, emitJson } from '../context.js';
import { color, say, section } from '../ui.js';

/**
 * Connection details for pasting into a project's .env or a DB client.
 * These are local development credentials by design — the same values the
 * containers were started with — so they are shown in full.
 */
export function infoCommand(ctx: Ctx): void {
  const e = ctx.env;

  const mysqlUrl = `mysql://${e.MYSQL_USER}:${e.MYSQL_PASSWORD}@localhost:${e.MYSQL_PORT}/${e.MYSQL_DATABASE}`;
  const redisUrl = `redis://localhost:${e.REDIS_PORT}`;
  const postgresUrl = `postgresql://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@localhost:${e.POSTGRES_PORT}/${e.POSTGRES_DB}`;

  if (ctx.json) {
    emitJson({
      home: ctx.home,
      mysql: {
        host: 'localhost',
        port: Number(e.MYSQL_PORT),
        database: e.MYSQL_DATABASE,
        user: e.MYSQL_USER,
        password: e.MYSQL_PASSWORD,
        rootPassword: e.MYSQL_ROOT_PASSWORD,
        url: mysqlUrl,
        containerHost: e.MYSQL_CONTAINER_NAME,
      },
      redis: {
        host: 'localhost',
        port: Number(e.REDIS_PORT),
        url: redisUrl,
        containerHost: e.REDIS_CONTAINER_NAME,
      },
      postgres: {
        host: 'localhost',
        port: Number(e.POSTGRES_PORT),
        database: e.POSTGRES_DB,
        user: e.POSTGRES_USER,
        password: e.POSTGRES_PASSWORD,
        url: postgresUrl,
        containerHost: e.POSTGRES_CONTAINER_NAME,
      },
      phpmyadmin: { url: `http://localhost:${e.PMA_PORT}` },
      pgadmin: {
        url: `http://localhost:${e.PGADMIN_PORT}`,
        email: e.PGADMIN_DEFAULT_EMAIL,
        password: e.PGADMIN_DEFAULT_PASSWORD,
      },
      mailpit: {
        ui: `http://localhost:${e.MAILPIT_HTTP_PORT}`,
        smtpHost: 'localhost',
        smtpPort: Number(e.MAILPIT_SMTP_PORT),
        containerHost: e.MAILPIT_CONTAINER_NAME,
      },
      minio: {
        console: `http://localhost:${e.MINIO_CONSOLE_PORT}`,
        api: `http://localhost:${e.MINIO_API_PORT}`,
        user: e.MINIO_ROOT_USER,
        password: e.MINIO_ROOT_PASSWORD,
        containerHost: e.MINIO_CONTAINER_NAME,
      },
      network: e.NETWORK_NAME,
    });
    return;
  }

  say.blank();
  console.log(`  ${color.brand(color.bold('Connection Info'))}`);
  say.blank();

  console.log(
    section('MySQL', [
      ['host', `localhost:${e.MYSQL_PORT}`],
      ['database', e.MYSQL_DATABASE],
      ['user', e.MYSQL_USER],
      ['password', e.MYSQL_PASSWORD],
      ['url', color.meta(mysqlUrl)],
      ['from container', `${e.MYSQL_CONTAINER_NAME}:3306`],
    ]),
  );
  say.blank();

  console.log(
    section('Redis', [
      ['host', `localhost:${e.REDIS_PORT}`],
      ['url', color.meta(redisUrl)],
      ['from container', `${e.REDIS_CONTAINER_NAME}:6379`],
    ]),
  );
  say.blank();

  console.log(
    section('PostgreSQL', [
      ['host', `localhost:${e.POSTGRES_PORT}`],
      ['database', e.POSTGRES_DB],
      ['user', e.POSTGRES_USER],
      ['password', e.POSTGRES_PASSWORD],
      ['url', color.meta(postgresUrl)],
      ['from container', `${e.POSTGRES_CONTAINER_NAME}:5432`],
    ]),
  );
  say.blank();

  console.log(section('phpMyAdmin', [['url', `http://localhost:${e.PMA_PORT}`]]));
  say.blank();

  console.log(
    section('pgAdmin', [
      ['url', `http://localhost:${e.PGADMIN_PORT}`],
      ['email', e.PGADMIN_DEFAULT_EMAIL],
      ['password', e.PGADMIN_DEFAULT_PASSWORD],
    ]),
  );
  say.blank();

  console.log(
    section('Mailpit', [
      ['ui', `http://localhost:${e.MAILPIT_HTTP_PORT}`],
      ['smtp', `localhost:${e.MAILPIT_SMTP_PORT}`],
      ['from container', `${e.MAILPIT_CONTAINER_NAME}:1025`],
    ]),
  );
  say.blank();

  console.log(
    section('MinIO', [
      ['console', `http://localhost:${e.MINIO_CONSOLE_PORT}`],
      ['api', `http://localhost:${e.MINIO_API_PORT}`],
      ['user', e.MINIO_ROOT_USER],
      ['password', e.MINIO_ROOT_PASSWORD],
      ['from container', `${e.MINIO_CONTAINER_NAME}:9000`],
    ]),
  );
  say.blank();

  console.log(`  ${color.meta(`network  ${e.NETWORK_NAME}`)}`);
  say.blank();
}
