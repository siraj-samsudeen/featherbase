'use strict';

// Boots the app for the acceptance run and shuts it down after, on its OWN
// database and ports, so a run never touches featherbase, featherbase_test or
// featherbase_e2e, and never collides with ./init.sh (8000/5173) or the e2e
// suite (8020/5193).
//
// It reuses the e2e isolated stack's code path rather than a copy of it:
// `pnpm --filter server e2e:serve` drops and recreates the database (refusing
// any name that does not end in _e2e, or one stamped for another environment),
// migrates it and starts the API; `pnpm --filter web dev` serves the web app
// pointed at that API. See apps/web/playwright.config.ts for why each
// variable below is set.

const { spawn } = require('node:child_process');
const path = require('node:path');
const { BeforeAll, AfterAll } = require('@cucumber/cucumber');

const REPO_ROOT = path.resolve(__dirname, '../..');
const API_PORT = Number(process.env.ACCEPTANCE_API_PORT ?? 8030);
const WEB_PORT = Number(process.env.ACCEPTANCE_WEB_PORT ?? 5203);
const BASE_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const BOOT_TIMEOUT_MS = 240_000;

// Same host and credentials as the developer's database, under its own name.
function acceptanceDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase');
  url.pathname = '/featherbase_acceptance_e2e';
  return url.toString();
}

const children = [];
const logs = [];

function start(name, args, env) {
  const child = spawn('pnpm', args, {
    cwd: REPO_ROOT,
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

BeforeAll({ timeout: BOOT_TIMEOUT_MS + 30_000 }, async function () {
  const api = start('api', ['--filter', 'server', 'e2e:serve'], {
    PORT: String(API_PORT),
    DATABASE_URL: acceptanceDatabaseUrl(),
    FEATHERBASE_ENV: 'test',
    ALLOW_MOCK_OAUTH: '1',
    PREAUTH_LOGIN_MAX: '10000',
    WEB_ORIGINS: BASE_URL,
  });
  const web = start('web', ['--filter', 'web', 'dev'], {
    WEB_PORT: String(WEB_PORT),
    API_PORT: String(API_PORT),
  });
  await waitFor(`${API_URL}/api/ping`, api, 'The API');
  await waitFor(BASE_URL, web, 'The web app');
});

AfterAll(function () {
  stopAll();
});

process.on('exit', stopAll);

module.exports = { BASE_URL, API_URL };
