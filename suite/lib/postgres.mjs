import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { command, run, freePort } from './process.mjs';

const token = () => randomBytes(12).toString('hex');
export async function sql(url, text, values = []) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

// Always owns a newly initialized cluster; there is intentionally no external/admin URL input.
export async function cluster() {
  const directory = await mkdtemp(path.join(tmpdir(), 'todo-suite-pg-'));
  const bin = process.env.PG_BIN || (await command(['pg_config', '--bindir'])).output.trim();
  const password = token();
  const passwordFile = path.join(directory, 'password');
  await writeFile(passwordFile, password, { mode: 0o600 });
  const data = path.join(directory, 'data');
  await command([`${bin}/initdb`, '-D', data, '-U', 'suite_admin', '--pwfile', passwordFile, '--auth=scram-sha-256']);
  const port = await freePort();
  const server = run([`${bin}/postgres`, '-D', data, '-h', '127.0.0.1', '-p', String(port), '-k', directory], { secrets: [password] });
  const admin = `postgresql://suite_admin:${password}@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; ; attempt++) {
    try { await sql(admin, 'SELECT 1'); break; } catch (error) {
      if (attempt === 100 || server.settled) { await server.stop(); throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await sql(admin, 'REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC');
  const databases = new Set();
  return {
    directory, bin,
    async database() {
      const name = `suite_${token()}`;
      const secret = token();
      await sql(admin, `CREATE ROLE ${name} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
      await sql(admin, `CREATE DATABASE ${name} OWNER ${name}`);
      await sql(admin, `REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
      const url = `postgresql://${name}:${secret}@127.0.0.1:${port}/${name}`;
      databases.add(name);
      return {
        name, url, secret,
        async query(text, values) { return sql(url, text, values); },
        async readOnly(enabled) { await sql(admin, `ALTER ROLE ${name} SET default_transaction_read_only = ${enabled ? 'on' : 'off'}`); },
        async outage(enabled) {
          await sql(admin, `ALTER ROLE ${name} ${enabled ? 'NOLOGIN' : 'LOGIN'}`);
          if (enabled) await sql(admin, 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [name]);
        },
        async backup(file) {
          await command([`${bin}/pg_dump`, '--format=custom', '--file', file, url], { secrets: [url, secret] });
        },
        async restore(file) {
          await command([`${bin}/pg_restore`, '--exit-on-error', '--no-owner', '--no-acl', '--dbname', url, file], { secrets: [url, secret] });
        },
        async drop() {
          if (!databases.delete(name)) return;
          await sql(admin, `DROP DATABASE ${name} WITH (FORCE)`);
          await sql(admin, `DROP ROLE ${name}`);
        },
      };
    },
    async close() { await server.stop(); await rm(directory, { recursive: true, force: true }); },
  };
}
