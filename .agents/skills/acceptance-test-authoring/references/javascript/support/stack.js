'use strict';

// Boots the app for the acceptance run and shuts it down after, on its OWN
// database and ports, so a run never touches the developer's database and
// never collides with the dev server, another test suite, or another
// worktree's run. Lines marked PROJECT: are the ones each project fills in.

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { BeforeAll, AfterAll } = require('@cucumber/cucumber');

const REPO_ROOT = path.resolve(__dirname, '../..');
const API_PORT = Number(process.env.ACCEPTANCE_API_PORT ?? 8030);
const WEB_PORT = Number(process.env.ACCEPTANCE_WEB_PORT ?? 5203);
const BASE_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const BOOT_TIMEOUT_MS = 240_000;

// PROJECT: the commands that start the app on its own, freshly reset
// database and on these ports, and a URL that answers 2xx once each is up.
// Drop the web entry if the API serves the pages itself.
const SERVICES = [
  {
    name: 'api',
    command: 'npm',
    args: ['run', 'start:api'],
    env: { PORT: String(API_PORT), DATABASE_URL: process.env.ACCEPTANCE_DATABASE_URL },
    readyUrl: `${API_URL}/health`,
    port: [API_PORT, 'ACCEPTANCE_API_PORT'],
  },
  {
    name: 'web',
    command: 'npm',
    args: ['run', 'dev:web'],
    env: { PORT: String(WEB_PORT), API_URL },
    readyUrl: BASE_URL,
    port: [WEB_PORT, 'ACCEPTANCE_WEB_PORT'],
  },
];

const children = [];
const logs = [];

function start({ name, command, args, env }) {
  const defined = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...defined },
    detached: true, // its own process group, so shutdown takes its children with it
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
  // them when the first run ends: both fail in ways that point nowhere near
  // the cause. So refuse, and say which port and which variable moves it.
  for (const { port: [port, variable] } of SERVICES) {
    if (await portTaken(port))
      throw new Error(
        `port ${port} is already in use, most likely by another acceptance run. ` +
          `Wait for it to finish, or run on other ports (${variable}).`,
      );
  }
  const started = SERVICES.map((service) => [service, start(service)]);
  for (const [service, child] of started) await waitFor(service.readyUrl, child, service.name);
});

AfterAll(function () {
  stopAll();
});

process.on('exit', stopAll);

module.exports = { BASE_URL, API_URL };
