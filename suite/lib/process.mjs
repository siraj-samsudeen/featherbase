import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';

export async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Commands are explicit argv arrays, never shell-expanded. Logs never contain supplied credentials.
export function run(argv, { cwd, env = {}, secrets = [], timeout = 120_000 } = {}) {
  if (!Array.isArray(argv) || !argv.length) throw new Error('Command must be a nonempty argv array');
  const child = spawn(argv[0], argv.slice(1), {
    cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const redact = text => secrets.filter(Boolean).reduce((s, key) => s.split(key).join('[REDACTED]'), text);
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const started = performance.now();
  let settled = false;
  const done = new Promise(resolve => {
    child.once('error', error => { settled = true; resolve({ code: null, error: error.message }); });
    child.once('close', (code, signal) => { settled = true; resolve({ code, signal }); });
  }).then(result => ({ ...result, output: redact(output), milliseconds: performance.now() - started }));
  function signal(value) {
    if (!child.pid) return;
    try { process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return {
    child, done, get output() { return redact(output); }, get settled() { return settled; },
    async stop(value = 'SIGTERM', limit = 10_000) {
      const stopping = performance.now();
      signal(value);
      const result = await Promise.race([done, sleep(limit, undefined, { ref: false }).then(() => null)]);
      if (result) { signal('SIGKILL'); return { ...result, shutdownMilliseconds: performance.now() - stopping }; } // Also reap surviving descendants.
      signal('SIGKILL');
      return { ...(await done), forcedAfterTimeout: true, shutdownMilliseconds: performance.now() - stopping };
    },
    async wait() {
      const result = await Promise.race([done, sleep(timeout, undefined, { ref: false }).then(() => null)]);
      if (result) return result;
      return { ...(await this.stop('SIGKILL')), timedOut: true };
    },
  };
}

export async function command(argv, options) {
  const result = await run(argv, options).wait();
  if (result.code !== 0 || result.timedOut) throw new Error(`Command failed (${result.code}): ${result.output}`);
  return result;
}

export async function waitStopped(url, timeout = 10_000) {
  const target = new URL(url);
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const refused = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: target.hostname, port: Number(target.port) });
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(true) : reject(error));
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Shutdown connection probe timed out')); });
    });
    if (refused) return;
    await sleep(100);
  }
  throw new Error('Application is still listening after its launcher exited');
}

export async function waitReady(url, processHandle, timeout = 60_000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (processHandle.settled) throw new Error(`Process exited before ready: ${processHandle.output}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return performance.now() - started;
    } catch { /* Retry only readiness, never test assertions or writes. */ }
    await sleep(100);
  }
  throw new Error(`Readiness timeout: ${processHandle.output}`);
}

export async function waitReachableOrExited(url, processHandle, timeout = 60_000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (processHandle.settled) return;
    try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return; } catch { /* Any HTTP status suffices here. */ }
    await sleep(100);
  }
  throw new Error(`Process neither listened nor exited: ${processHandle.output}`);
}
