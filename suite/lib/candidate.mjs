import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run, freePort, waitReady, waitReachableOrExited, waitStopped } from './process.mjs';
import { API } from './http.mjs';

export async function configuration() {
  assert.ok(process.env.CANDIDATE_CONFIG, 'Set CANDIDATE_CONFIG to a manager-owned JSON mapping. No candidate or reference app is bundled.');
  const filename = path.resolve(process.env.CANDIDATE_CONFIG);
  const config = JSON.parse(await readFile(filename, 'utf8'));
  config.cwd = path.resolve(path.dirname(filename), config.cwd);
  for (const name of ['install', 'build', 'check', 'test', 'migrate', 'start']) assert.ok(Array.isArray(config.commands[name]), `Missing command ${name}`);
  assert.ok(config.readiness?.startsWith('/'), 'Readiness HTTP path required');
  assert.match(config.migrationHistoryQuery || '', /^\s*SELECT\b/i, 'Supply a manager-reviewed SELECT of the durable migration ledger, with stable ordering');
  for (const [kind, category] of Object.entries(config.http.errors)) {
    for (const [otherKind, other] of Object.entries(config.http.errors)) {
      if (kind !== otherKind) assert.ok(!category.statuses.some(status => other.statuses.includes(status) && category.codes.some(code => other.codes.includes(code))), `Indistinguishable ${kind}/${otherKind} errors`);
    }
  }
  return config;
}

export async function candidate(config, database, evidence = []) {
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const options = {
    cwd: config.cwd,
    env: { ...config.env, DATABASE_URL: database.url, PORT: String(port), BASE_URL: baseURL, NODE_ENV: 'production' },
    secrets: [database.url, database.secret], timeout: config.commandTimeout ?? 180_000,
  };
  let processHandle;
  const api = new API(baseURL, config.http);
  return {
    baseURL, api, database, config,
    async execute(name) {
      const result = await run(config.commands[name], { ...options, env: { ...options.env, NODE_ENV: name === 'install' ? 'development' : name === 'test' ? 'test' : 'production' } }).wait();
      evidence.push({ command: name, ...result });
      return result;
    },
    async migrate() {
      const result = await this.execute('migrate');
      assert.equal(result.code, 0, result.output);
      assert.ok(!result.timedOut, 'Migration timed out');
    },
    async start(ready = true) {
      assert.ok(!processHandle || processHandle.settled, 'App already running');
      processHandle = run(config.commands.start, options);
      if (!ready) await waitReachableOrExited(new URL(config.readiness, baseURL), processHandle, config.readinessTimeout);
      if (ready) {
        evidence.push({ command: 'startup', milliseconds: await waitReady(new URL(config.readiness, baseURL), processHandle, config.readinessTimeout) });
        await api.discover();
        await api.list(); // Readiness must permit an actual database-backed operation.
      }
    },
    async stop(signal = 'SIGTERM') {
      if (!processHandle) return;
      if (signal === 'SIGKILL' && config.commands.forceStop) {
        const forced = await this.execute('forceStop');
        assert.equal(forced.code, 0, forced.output);
        assert.ok(!forced.timedOut, 'External force-stop timed out');
      }
      const result = await processHandle.stop(signal, config.shutdownTimeout ?? 10_000);
      evidence.push({ command: signal, ...result });
      await waitStopped(baseURL, config.shutdownTimeout ?? 10_000);
      processHandle = undefined;
      return result;
    },
    async restart(signal) { await this.stop(signal); await this.start(); },
  };
}
