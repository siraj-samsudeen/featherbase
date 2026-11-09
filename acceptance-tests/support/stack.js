'use strict';

// Boots the app for the acceptance run and shuts it down after, on its OWN
// database and ports, so a run never touches featherbase, featherbase_test or
// featherbase_e2e, and never collides with ./init.sh (8000/5173) or the e2e
// suite (8020/5193).
//
// It reuses the e2e isolated stack's reset and migration commands:
// `pnpm --filter server e2e:reset` drops and recreates the database (refusing
// any name that does not end in _e2e, or one stamped for another environment),
// then `migrate` and `start` boot the API; `pnpm --filter web dev` serves the web app
// pointed at that API. See apps/web/playwright.config.ts for why each
// variable below is set.

const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { BeforeAll, AfterAll } = require('@cucumber/cucumber');

const REPO_ROOT = path.resolve(__dirname, '../..');
const API_PORT = Number(process.env.ACCEPTANCE_API_PORT ?? 8030);
const WEB_PORT = Number(process.env.ACCEPTANCE_WEB_PORT ?? 5203);
const PROTOTYPE_PORT = Number(process.env.ACCEPTANCE_PROTOTYPE_PORT ?? 5383);
const BASE_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const PROTOTYPE_URL = `http://localhost:${PROTOTYPE_PORT}`;
const BOOT_TIMEOUT_MS = 240_000;

// Same host and credentials as the developer's database, under its own name.
function acceptanceDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase');
  const name = process.env.ACCEPTANCE_DATABASE_NAME ?? 'featherbase_acceptance_e2e';
  if (!/^featherbase_[a-z0-9_]+_e2e$/.test(name))
    throw new Error('ACCEPTANCE_DATABASE_NAME must be a disposable featherbase_*_e2e database');
  url.pathname = `/${name}`;
  return url.toString();
}

// An outside database for data-source scenarios: a sibling of the acceptance
// database (a data source may never reach the platform's own), read through a
// login that owns nothing. Its password is new each run; the API is started
// knowing the URL, under the variable a scenario's data source names.
const EXTERNAL_URL_ENV = 'ACCEPTANCE_EXTERNAL_READER_URL';
const EXTERNAL_READER = 'acceptance_external_reader';
const EXTERNAL_READER_PASSWORD = require('node:crypto').randomBytes(18).toString('hex');

function externalDatabaseUrl({ asReader = false } = {}) {
  const url = new URL(acceptanceDatabaseUrl());
  url.pathname = `${url.pathname}_ext`;
  if (asReader) {
    url.username = EXTERNAL_READER;
    url.password = EXTERNAL_READER_PASSWORD;
  }
  return url.toString();
}

async function ensureExternalDatabase() {
  const name = new URL(externalDatabaseUrl()).pathname.slice(1);
  const [exists] = await acceptanceSql('select 1 from pg_database where datname = $1', [name]);
  if (!exists) await acceptanceSql(`create database "${name}"`);
}

/** Runs SQL on the outside database as its owner. */
async function externalSql(statement, parameters = []) {
  const { default: postgres } = require(require.resolve('postgres', { paths: [path.join(REPO_ROOT, 'apps/server')] }));
  const db = postgres(externalDatabaseUrl(), { max: 1, prepare: false, onnotice() {} });
  try { return await db.unsafe(statement, parameters); }
  finally { await db.end(); }
}

// #969: the one token every MotherDuck source reads, made up, for the stand-in
// (apps/server/test/motherduck-standin.ts).
const STANDIN_READER_TOKEN = 'standin-read-token-4f2a';

const children = [];
const logs = [];
let apiChild;
let scenarioEnvironment;

function isolatedEnvironment(overrides = {}) {
  return {
    ...process.env, DATABASE_URL: acceptanceDatabaseUrl(), PORT: String(API_PORT),
    API_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT), FEATHERBASE_ENV: 'test',
    FEATHERBASE_INSTANCE: '', FEATHERBASE_APP_PATHS: '[]', MOTHERDUCK_TOKEN: STANDIN_READER_TOKEN,
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '',
    GOOGLE_CLIENT_SECRET: 'acceptance-private-secret',
    ALLOW_MOCK_OAUTH: '1', PREAUTH_LOGIN_MAX: '10000', WEB_ORIGINS: BASE_URL,
    [EXTERNAL_URL_ENV]: externalDatabaseUrl({ asReader: true }),
    ...overrides,
  };
}

/** Runs the server's MotherDuck stand-in script; `build` returns the new folder. */
function motherDuckStandin(...args) {
  const out = execFileSync('pnpm', ['--filter', 'server', 'exec', 'tsx', 'scripts/motherduck-standin.ts', ...args],
    { cwd: REPO_ROOT, timeout: 60_000, stdio: 'pipe' });
  return out.toString().trim().split('\n').pop();
}

/** Adds a table to a stand-in database, as if the warehouse grew. */
function addStandinTable(database, table) {
  motherDuckStandin('add', process.env.MOTHERDUCK_STANDIN, database, table);
}

/** Changes only the run's synthetic warehouse, never a hosted account. */
function changeStandin(database, statements) {
  motherDuckStandin('change', process.env.MOTHERDUCK_STANDIN, database, JSON.stringify(statements));
}

async function acceptanceSql(statement, parameters = []) {
  const { default: postgres } = require(require.resolve('postgres', { paths: [path.join(REPO_ROOT, 'apps/server')] }));
  const db = postgres(acceptanceDatabaseUrl(), { max: 1, prepare: false, onnotice() {} });
  try { return await db.unsafe(statement, parameters); }
  finally { await db.end(); }
}

async function stopApi() {
  const group = apiChild?.pid;
  if (apiChild?.exitCode === null && apiChild.signalCode === null) {
    process.kill(-group, 'SIGTERM');
    await new Promise(resolve => apiChild.once('exit', resolve));
  }
  apiChild = undefined;
  // pnpm can exit while the server under it (tsx and node, in pnpm's process
  // group) still holds the port. A new API started then cannot listen, and the
  // old one, with the old environment and apps, goes on answering every
  // request. So the API is stopped only once its port is free.
  const started = Date.now();
  while (await portTaken(API_PORT)) {
    const waited = Date.now() - started;
    if (waited > 30_000) throw new Error(`The API on port ${API_PORT} did not stop within 30 seconds.`);
    if (group) {
      try { process.kill(-group, waited > 5_000 ? 'SIGKILL' : 'SIGTERM'); } catch { /* the group is gone */ }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// Change host configuration without replacing the scenario's saved data/sessions.
async function restartAcceptance(overrides = {}, root = REPO_ROOT) {
  await stopApi();
  scenarioEnvironment = { ...(scenarioEnvironment ?? isolatedEnvironment()), ...overrides };
  apiChild = start('api', ['--filter', 'server', 'start'], scenarioEnvironment, root);
  await waitFor(`${API_URL}/api/ping`, apiChild, 'The scenario API');
}

// #969: a scenario that reads the warehouse says which instance token it needs;
// an earlier scenario may have left another one, or none, on the shared API.
async function useInstanceToken(token = STANDIN_READER_TOKEN) {
  if ((scenarioEnvironment ?? isolatedEnvironment()).MOTHERDUCK_TOKEN !== token) await restartAcceptance({ MOTHERDUCK_TOKEN: token });
}

// Reset only our disposable DB, with the API stopped (its metadata is cached).
// Local/hosted health scenarios need distinct real process environments. Restore
// the test stamp before calling the existing guarded reset, never another DB.
async function resetAcceptance(overrides = {}, root = REPO_ROOT) {
  await stopApi();
  await acceptanceSql("update featherbase.internal_metadata set value = 'test' where key = 'environment'");
  const env = isolatedEnvironment();
  for (const command of ['e2e:reset', 'migrate']) {
    execFileSync('pnpm', ['--filter', 'server', command], { cwd: REPO_ROOT, env, timeout: 120_000, stdio: 'pipe' });
  }
  scenarioEnvironment = isolatedEnvironment(overrides);
  await acceptanceSql("update featherbase.internal_metadata set value = $1 where key = 'environment'", [scenarioEnvironment.FEATHERBASE_ENV]);
  await restartAcceptance({}, root);
}

function start(name, args, env, root = REPO_ROOT) {
  const child = spawn('pnpm', args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true, // its own process group, so shutdown takes tsx/vite with it
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk) => {
    logs.push(`[${name}] ${chunk}`);
    if (logs.length > 400) logs.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push(child);
  return child;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not come up at ${url}.\n--- last output ---\n${logs.slice(-60).join('')}`);
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Whether something already answers on this localhost port. */
function portTaken(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: 'localhost' });
    socket.setTimeout(1_000);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

BeforeAll({ timeout: BOOT_TIMEOUT_MS + 30_000 }, async function () {
  // A second run started while one is going would answer its boot checks from
  // the first run's servers, reset the database under them, and then lose
  // them when the first run ends: both fail with lists that never show.
  for (const [port, name] of [[API_PORT, 'ACCEPTANCE_API_PORT'], [WEB_PORT, 'ACCEPTANCE_WEB_PORT'], [PROTOTYPE_PORT, 'ACCEPTANCE_PROTOTYPE_PORT']]) {
    if (await portTaken(port))
      throw new Error(
        `port ${port} is already in use, most likely by another acceptance run. ` +
          `Wait for it to finish, or run on other ports (${name}).`,
      );
  }
  // #772 design D4: a local stand-in for MotherDuck, made fresh for each run.
  process.env.MOTHERDUCK_STANDIN = motherDuckStandin('build');
  const env = isolatedEnvironment();
  for (const command of ['e2e:reset', 'migrate'])
    execFileSync('pnpm', ['--filter', 'server', command], { cwd: REPO_ROOT, env, timeout: 120_000, stdio: 'pipe' });
  await ensureExternalDatabase();
  // No watcher: tsx watch starts its own process group and can survive the
  // scenario API's shutdown, retaining stale schema and environment state.
  const api = apiChild = start('api', ['--filter', 'server', 'start'], env);
  const web = start('web', ['--filter', 'web', 'dev'], {
    WEB_PORT: String(WEB_PORT),
    API_PORT: String(API_PORT),
  });
  const prototype = start('prototype', ['--filter', 'web', 'exec', 'vite', '--config', 'vite.prototype.config.ts'], {
    PROTOTYPE_PORT: String(PROTOTYPE_PORT),
  });
  await waitFor(`${API_URL}/api/ping`, api, 'The API');
  await waitFor(BASE_URL, web, 'The web app');
  await waitFor(`${PROTOTYPE_URL}/__lab/scenario`, prototype, 'The synthetic prototype');
});

AfterAll(async function () {
  stopAll();
  if (scenarioEnvironment) await acceptanceSql("update featherbase.internal_metadata set value = 'test' where key = 'environment'");
});

process.on('exit', stopAll);

module.exports = {
  BASE_URL, API_URL, PROTOTYPE_URL, resetAcceptance, restartAcceptance, useInstanceToken, acceptanceSql, acceptanceDatabaseUrl, isolatedEnvironment, REPO_ROOT,
  externalSql, EXTERNAL_URL_ENV, EXTERNAL_READER, EXTERNAL_READER_PASSWORD, addStandinTable, changeStandin,
};
