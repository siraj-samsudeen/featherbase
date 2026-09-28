import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures.mjs';
import { candidate } from '../lib/candidate.mjs';
import { sql } from '../lib/postgres.mjs';
import { notReady, unchanged } from '../lib/assertions.mjs';

test('Private non-superuser databases reject cross-candidate access', async ({ database, postgres }) => {
  const other = await postgres.database();
  try {
    const flags = (await database.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0];
    expect(flags).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    const cross = new URL(database.url);
    cross.pathname = `/${other.name}`;
    await expect(sql(cross.href, 'SELECT 1')).rejects.toMatchObject({ code: '42501' });
    const reverse = new URL(other.url);
    reverse.pathname = `/${database.name}`;
    await expect(sql(reverse.href, 'SELECT 1')).rejects.toMatchObject({ code: '42501' });
  } finally { await other.drop(); }
});

test('Graceful and forced restart preserve changes, identities and deletions', async ({ app }) => {
  let renamed = await app.api.create('Original');
  renamed = await app.api.change('rename', renamed, { title: 'Persisted rename' });
  let completed = await app.api.create('Completed');
  completed = await app.api.change('complete', completed, { completed: true });
  const deleted = await app.api.create('Deleted');
  await app.api.change('delete', deleted);
  const before = await app.api.snapshot();
  const graceful = await app.stop();
  expect(graceful.forcedAfterTimeout).not.toBe(true);
  await app.start();
  unchanged(await app.api.snapshot(), before);
  await app.restart('SIGKILL');
  unchanged(await app.api.snapshot(), before);
  app.api.error(await app.api.call('read', deleted), 'missing');
  expect(await app.api.read(renamed.id)).toEqual(renamed);
  expect(await app.api.read(completed.id)).toEqual(completed);
});

test('Migration rerun and concurrent runners preserve data', async ({ app }) => {
  const record = await app.api.create('Migration sentinel');
  const before = await app.api.snapshot();
  const history = (await app.database.query(app.config.migrationHistoryQuery)).rows;
  expect(history.length).toBeGreaterThan(0);
  await app.stop();
  await app.migrate();
  const results = await Promise.all([app.execute('migrate'), app.execute('migrate')]);
  expect(results.some(result => result.code === 0)).toBe(true);
  for (const result of results) {
    expect(result.timedOut).not.toBe(true);
    if (result.code !== 0) expect(result.output).toMatch(/lock|concurr|already.*running/i);
  }
  await app.start();
  expect(await app.api.snapshot()).toEqual(before);
  expect(await app.api.read(record.id)).toEqual(record);
  unchanged((await app.database.query(app.config.migrationHistoryQuery)).rows, history);
});

test('Empty-schema readiness, genuine migration denial and safe retry', async ({ harness, database }) => {
  // Verify a real SQL failure, not just an environment flag the app may ignore.
  await database.readOnly(true);
  await expect(database.query('CREATE TABLE denied_probe (id integer)')).rejects.toMatchObject({ code: '25006' });
  try {
    await harness.start(false);
    for (let i = 0; i < 10; i++) {
      await notReady(new URL(harness.config.readiness, harness.baseURL));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await harness.stop();
    const result = await harness.execute('migrate');
    expect(result.code).not.toBe(0);
    expect(result.timedOut).not.toBe(true);
    unchanged((await database.query("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")).rows, []);
  } finally { await database.readOnly(false); }
  await harness.migrate();
  await harness.start();
  const record = await harness.api.create('After retry');
  await harness.stop();
  await harness.migrate();
  await harness.start();
  expect(await harness.api.read(record.id)).toEqual(record);
});

test('Two first-time migrations safely initialize a fresh database', async ({ harness, database }) => {
  const results = await Promise.all([harness.execute('migrate'), harness.execute('migrate')]);
  expect(results.some(result => result.code === 0)).toBe(true);
  for (const result of results) {
    expect(result.timedOut).not.toBe(true);
    if (result.code !== 0) expect(result.output).toMatch(/lock|concurr|already.*running/i);
  }
  const history = (await database.query(harness.config.migrationHistoryQuery)).rows;
  expect(history.length).toBeGreaterThan(0);
  await harness.start();
  expect((await harness.api.create('After competing migrations')).title).toBe('After competing migrations');
});

test('Database outage is not success; reconnect without reset', async ({ app, database }) => {
  const record = await app.api.create('Saved before outage');
  await database.outage(true);
  await expect(database.query('SELECT 1')).rejects.toMatchObject({ code: '28000' });
  try {
    await notReady(new URL(app.config.readiness, app.baseURL));
    for (const name of ['create', 'rename', 'complete', 'delete']) {
      const args = { ...record, key: randomUUID(), title: 'Must not save', completed: true };
      app.api.validateRequest(name, args);
      const request = app.api.request(name, args);
      const response = await fetch(request.url, { ...request, signal: AbortSignal.timeout(10_000) });
      expect(response.status).toBeGreaterThanOrEqual(500);
    }
  } finally { await database.outage(false); }
  await expect.poll(async () => app.api.snapshot(), { timeout: 30_000 }).toEqual([{ id: record.id, title: record.title, completed: false }]);
  expect((await app.api.create('Recovered')).title).toBe('Recovered');
});

test('Backup restores saved records into a separate disposable database', async ({ app, postgres, config }) => {
  let record = await app.api.create('Backup sentinel');
  record = await app.api.change('complete', record, { completed: true });
  const before = await app.api.snapshot();
  const file = path.join(postgres.directory, 'snapshot.dump');
  await app.database.backup(file);
  await app.api.change('delete', record);
  expect(await app.api.snapshot()).toEqual([]);
  await app.stop(); // A file-backed fake cannot use the now-deleted original record to pass restoration.
  const restored = await postgres.database();
  const copy = await candidate(config, restored);
  try {
    await restored.restore(file);
    await copy.start();
    expect(await copy.api.snapshot()).toEqual(before);
    expect(await copy.api.read(record.id)).toEqual(record);
  } finally { await copy.stop(); await restored.drop(); }
});
