import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { cluster, sql } from '../lib/postgres.mjs';
import { command, run, freePort, waitReady } from '../lib/process.mjs';
import { inject } from '../lib/faults.mjs';
import { exactlyOneWinner, unchanged, notReady } from '../lib/assertions.mjs';
import { draftRetained, conflict, layout, associatedError, accessible } from '../lib/ui.mjs';
import { API } from '../lib/http.mjs';
import { candidate } from '../lib/candidate.mjs';

const evidenceDir = path.resolve('suite-results/selftest');
const evidence = [];
let postgres;
before(async () => { await mkdir(evidenceDir, { recursive: true }); postgres = await cluster(); });
after(async () => {
  await postgres?.close();
  await writeFile(path.join(evidenceDir, 'negative-controls.json'), JSON.stringify(evidence, null, 2));
});
async function killed(name, assertion, pattern) {
  let failure;
  try { await assertion(); } catch (error) { failure = error; }
  assert.ok(failure, `${name}: faulty control survived`);
  assert.match(failure.message, pattern, `${name}: failed for an unrelated reason`);
  evidence.push({ mutant: name, verdict: 'detected', assertion: failure.message });
}
const probe = path.resolve('suite/selftest/probe.mjs');
function options(database, extra = {}) { return { env: { DATABASE_URL: database.url, ...extra }, secrets: [database.url, database.secret] }; }
async function migrate(database, extra = {}) { return run([process.execPath, probe, 'migrate'], options(database, extra)).wait(); }
async function startProbe(database, bug) {
  const port = await freePort();
  const processHandle = run([process.execPath, probe], options(database, { PORT: String(port), PROBE_BUG: bug || '' }));
  const url = `http://127.0.0.1:${port}`;
  await waitReady(url, processHandle);
  return { url, processHandle };
}

test('Real PostgreSQL roles, cross-database denial, outage, backup and restore', async () => {
  const a = await postgres.database();
  const b = await postgres.database();
  try {
    assert.equal((await migrate(a)).code, 0);
    const role = (await a.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    for (const [from, to] of [[a, b], [b, a]]) {
      const cross = new URL(from.url); cross.pathname = `/${to.name}`;
      await assert.rejects(sql(cross.href, 'SELECT 1'), { code: '42501' });
    }
    await a.query('UPDATE harness_counter SET value=17, version=9');
    const backup = path.join(postgres.directory, 'selftest.dump');
    await a.backup(backup);
    await b.restore(backup);
    unchanged((await b.query('SELECT * FROM harness_counter')).rows, [{ id: 1, value: 17, version: 9 }]);
    await a.outage(true);
    await assert.rejects(a.query('SELECT 1'), { code: '28000' });
    await a.outage(false);
    assert.equal((await a.query('SELECT value FROM harness_counter')).rows[0].value, 17);
  } finally { await a.drop(); await b.drop(); }
});

test('Migration real failure/retry, read-only denial and false applied-ledger mutant', async () => {
  const database = await postgres.database();
  try {
    await database.readOnly(true);
    await assert.rejects(database.query('CREATE TABLE denied (id integer)'), { code: '25006' });
    assert.equal((await migrate(database)).code, 1);
    await database.readOnly(false);
    assert.equal((await migrate(database, { PROBE_FAIL: '1' })).code, 1);
    const tables = async () => (await database.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    unchanged(await tables(), []);
    assert.equal((await migrate(database, { PROBE_FAIL: '1', PROBE_BUG: 'false-ledger' })).code, 1);
    await killed('unfinished migration marked applied', async () => unchanged(await tables(), []), /Confirmed state changed/);
    // The broken fixture is disposed; a separate clean database proves genuine retry.
    const clean = await postgres.database();
    try {
      assert.equal((await migrate(clean, { PROBE_FAIL: '1' })).code, 1);
      assert.equal((await migrate(clean)).code, 0);
      await clean.query('UPDATE harness_counter SET value=23');
      assert.equal((await migrate(clean)).code, 0);
      const runs = await Promise.all([migrate(clean), migrate(clean)]);
      assert.ok(runs.every(r => r.code === 0));
      assert.equal((await clean.query('SELECT value FROM harness_counter')).rows[0].value, 23);
    } finally { await clean.drop(); }
  } finally { await database.drop(); }
});

test('Supervised graceful/forced restart and destructive-state mutant', async () => {
  const database = await postgres.database();
  let processHandle;
  try {
    assert.equal((await migrate(database)).code, 0);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const running = await startProbe(database); processHandle = running.processHandle;
      await fetch(`${running.url}/probe`, { method: 'POST' });
      const before = (await database.query('SELECT * FROM harness_counter')).rows;
      const stopped = await processHandle.stop(signal);
      assert.ok(!stopped.forcedAfterTimeout);
      const restarted = await startProbe(database); processHandle = restarted.processHandle;
      unchanged(await (await fetch(`${restarted.url}/probe`)).json(), before);
      await processHandle.stop();
    }
    const before = (await database.query('SELECT * FROM harness_counter')).rows;
    await database.query('UPDATE harness_counter SET value=0');
    await killed('restart reset loses confirmed data', async () => unchanged((await database.query('SELECT * FROM harness_counter')).rows, before), /Confirmed state changed/);
  } finally { await processHandle?.stop(); await database.drop(); }
});

test('False readiness and unconditional competing writes are detected over HTTP', async () => {
  const database = await postgres.database();
  let processHandle;
  try {
    const lying = await startProbe(database, 'false-ready'); processHandle = lying.processHandle;
    await killed('ready without required schema', () => notReady(`${lying.url}/ready`), /Readiness falsely/);
    await processHandle.stop();
    assert.equal((await migrate(database)).code, 0);
    for (const bug of ['', 'overwrite']) {
      await database.query('UPDATE harness_counter SET value=0, version=0');
      const running = await startProbe(database, bug); processHandle = running.processHandle;
      const results = await Promise.all([fetch(`${running.url}/cas`, { method: 'POST' }), fetch(`${running.url}/cas`, { method: 'POST' })]);
      if (bug) await killed('both stale writes succeed', () => exactlyOneWinner(results), /Exactly one competing write/);
      else exactlyOneWinner(results);
      await processHandle.stop();
    }
  } finally { await processHandle?.stop(); await database.drop(); }
});

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(`${name}: real transport abort, commit then lost reply, hold and two contexts`, async () => {
    const database = await postgres.database();
    const browser = await engine.launch();
    let processHandle;
    try {
      assert.equal((await migrate(database)).code, 0);
      const running = await startProbe(database); processHandle = running.processHandle;
      const a = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const b = await browser.newContext({ serviceWorkers: 'block' });
      const page = await a.newPage();
      const other = await b.newPage();
      await Promise.all([page.goto(running.url), other.goto(running.url)]);
      await a.tracing.start({ screenshots: true, snapshots: true });
      for (const mode of ['abort', 'lost-response', 'hold']) {
        await database.query('UPDATE harness_counter SET value=0, version=0');
        const fault = await inject(a, r => new URL(r.url()).pathname === '/probe' && r.method() === 'POST', mode);
        try {
          await page.getByRole('button', { name: 'Send probe', exact: true }).click();
          await fault.observed;
          if (mode === 'hold') {
            assert.equal((await database.query('SELECT value FROM harness_counter')).rows[0].value, 0);
            await other.getByRole('button', { name: 'Send probe', exact: true }).click();
            await expect(other.getByRole('status')).toHaveText('Reply 200');
            fault.release();
            await expect(page.getByRole('status')).toHaveText('Reply 200');
            assert.equal((await database.query('SELECT value FROM harness_counter')).rows[0].value, 2);
          } else {
            await expect(page.getByRole('status')).toHaveText('Reply lost');
            assert.equal((await database.query('SELECT value FROM harness_counter')).rows[0].value, mode === 'abort' ? 0 : 1);
          }
          evidence.push({ engine: name, ...fault.verify() });
          if (mode === 'lost-response') {
            await page.getByRole('button', { name: 'Send probe', exact: true }).click(); // Deliberately unsafe recovery.
            await expect(page.getByRole('status')).toHaveText('Reply 200');
            await killed(`${name}: blind retry duplicates committed write`, async () => unchanged((await database.query('SELECT value FROM harness_counter')).rows[0].value, 1), /Confirmed state changed/);
          }
        } finally { await fault.close(); }
      }
      const noMatch = await inject(a, () => false);
      await killed(`${name}: missed interception cannot pass`, () => noMatch.verify(), /Fault injection did not intercept/);
      await noMatch.close();
      await a.tracing.stop({ path: path.join(evidenceDir, `${name}-negative-transport.zip`) });
      await a.close(); await b.close();
    } finally { await browser.close(); await processHandle?.stop(); await database.drop(); }
  });
}

test('Shared UI assertions reject erased drafts, missing conflicts, overflow and inaccessible errors', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const html = (value = 'Kept draft', alert = 'Todo changed', width = 'auto', invalid = 'true', described = 'error') => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Harness-only semantic control</title><style>body{font:18px system-ui;margin:24px}main{width:${width}}input{max-width:100%}</style><body><main><h1>Harness-only semantic control</h1><p>This is not a Todo application.</p><section role="group" aria-label="Rename todo"><label>Todo title<input value="${value}" aria-invalid="${invalid}" aria-describedby="${described}"></label><button>Save</button><button>Cancel</button></section><p id="error" role="alert">${alert}</p><button>Review latest</button></main></body></html>`;
  try {
    await page.setContent(html());
    await draftRetained(page, 'Kept draft'); await conflict(page, 'Kept draft'); await layout(page);
    await associatedError(page.getByRole('textbox', { name: 'Todo title', exact: true }));
    await accessible(page);
    await page.setContent(html(''));
    await killed('rename failure erases draft', () => draftRetained(page, 'Kept draft'), /toHaveValue/);
    await page.setContent(html('Kept draft', 'Saved successfully'));
    await killed('stale edit reports success', () => conflict(page, 'Kept draft'), /toContainText/);
    await page.setContent(html('Kept draft', 'Todo changed', '900px'));
    await killed('mobile horizontal overflow', () => layout(page), /toBe/);
    await page.screenshot({ path: path.join(evidenceDir, 'negative-overflow.png'), fullPage: true });
    await page.setContent(html('Kept draft', 'Todo changed', 'auto', 'true', 'nonexistent'));
    await killed('input error association absent', () => associatedError(page.getByRole('textbox', { name: 'Todo title', exact: true })), /toBe/);
    await page.setContent('<!doctype html><html lang="en"><title>Broken label</title><body><main><h1>Harness-only broken label</h1><input></main></body></html>');
    await killed('unlabelled control', () => accessible(page), /toEqual/);
    await context.tracing.stop({ path: path.join(evidenceDir, 'negative-semantics.zip') });
  } finally { await browser.close(); }
});

test('Published HTTP schemas catch lying payloads and error classification', async () => {
  const schema = { type: 'object', required: ['id', 'title', 'completed', 'version'], properties: { id: { type: 'integer' }, title: { type: 'string' }, completed: { type: 'boolean' }, version: { type: 'integer' } } };
  const response = { description: 'Probe', content: { 'application/json': { schema: { $ref: '/record-schema.json' } } } };
  const doc = { openapi: '3.1.0', info: { title: 'Harness-only schema probe', version: '1' }, paths: { '/probe': { get: { responses: { 200: response } } } } };
  let broken = false;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/openapi.json' ? doc : request.url === '/record-schema.json' ? schema : { id: 7, title: 'Probe only', completed: broken ? 'false' : false, version: 1 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = new API(`http://127.0.0.1:${server.address().port}`, {
    openapi: '/openapi.json', operations: Object.fromEntries(['list', 'read', 'create', 'rename', 'complete', 'delete'].map(name => [name, { method: 'GET', path: '/probe' }])),
    fields: { record: '', id: '/id', title: '/title', completed: '/completed', proof: '/version', error: '/code' },
    errors: { conflict: { statuses: [409], codes: ['conflict'] } },
  });
  try {
    await api.discover();
    assert.deepEqual(await api.read(7), { id: 7, title: 'Probe only', completed: false, proof: 1 });
    broken = true;
    await killed('HTTP response violates published boolean schema', () => api.read(7), /must be boolean/);
    await killed('missing record misclassified as conflict', () => api.error({ status: 404, body: { code: 'missing' } }, 'conflict'), /assert|false|truthy/i);
    assert.equal(api.matches('read', { method: () => 'GET', url: () => `${api.baseURL}/unrelated` }), false);
    api.mapping.operations.create = { method: 'POST', path: '/probe', body: { title: '$title' } };
    api.document.paths['/probe'].post = { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string', maxLength: 200 } }, required: ['title'] } } } } };
    api.validateRequest('create', { title: '😀'.repeat(200) });
    api.document.paths['/probe'].post.requestBody.content['application/json'].schema = { type: 'object', properties: { title: { type: 'string', maxLength: 1 } } };
    await killed('published input schema excludes valid 200-code-point title', () => api.validateRequest('create', { title: '😀'.repeat(200) }), /Valid create request violates published schema/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Command failure, timeout and secret redaction remain diagnostic', async () => {
  const failed = await run([process.execPath, '-e', 'console.error(process.env.PROBE_SECRET);process.exit(7)'], { env: { PROBE_SECRET: 'do-not-leak-probe' }, secrets: ['do-not-leak-probe'] }).wait();
  assert.equal(failed.code, 7);
  assert.equal(failed.output.trim(), '[REDACTED]');
  const timed = await run([process.execPath, '-e', 'setInterval(()=>{},1000)'], { timeout: 100 }).wait();
  assert.equal(timed.timedOut, true);
  await assert.rejects(command(['this-command-does-not-exist-suite']), /Command failed/);
});

test('Exited launcher cannot masquerade as server shutdown; external force-stop is verified', async () => {
  const database = await postgres.database();
  const commands = { start: [process.execPath, '-e', 'setInterval(()=>{},1000)'] };
  const events = [];
  const app = await candidate({ commands, http: {}, readiness: '/ready', shutdownTimeout: 300 }, database, events);
  const server = http.createServer((request, response) => {
    if (request.url === '/stop') { response.end('stopped'); server.close(); }
    else { response.writeHead(503); response.end('not ready is not stopped'); }
  });
  try {
    await new Promise(resolve => server.listen(Number(new URL(app.baseURL).port), '127.0.0.1', resolve));
    await app.start(false);
    await killed('launcher exits but daemon still listens', () => app.stop('SIGKILL'), /still listening/);
    commands.forceStop = [process.execPath, '-e', "fetch(process.env.BASE_URL + '/stop').then(r => { if (!r.ok) process.exitCode = 1; })"];
    await app.stop('SIGKILL');
    assert.equal(events.find(event => event.command === 'forceStop')?.code, 0);
    assert.equal(server.listening, false);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await app.stop();
    await database.drop();
  }
});

test('Declarative mappings preserve invalid types, encode identities and omit missing proof', () => {
  const api = new API('http://127.0.0.1:9999', {
    operations: {
      complete: { method: 'PATCH', path: '/records/{recordKey}', pathArgs: { recordKey: '$id' }, headers: { 'if-match': '$proof' }, body: { state: '$completed' }, values: { completed: { true: 'done', false: 'open' } } },
    },
    fields: { id: '/key', title: '/name', completed: '/state', stateValues: { open: 'open', completed: 'done' }, proofHeader: 'etag' },
  });
  const good = api.request('complete', { id: 'a/b ?', completed: true, proof: '"v2"' });
  assert.equal(good.url.pathname, '/records/a%2Fb%20%3F');
  assert.deepEqual(JSON.parse(good.body), { state: 'done' });
  assert.equal(good.headers['if-match'], '"v2"');
  const invalid = api.request('complete', { id: 3, completed: 'true' });
  assert.deepEqual(JSON.parse(invalid.body), { state: 'true' });
  assert.equal(Object.hasOwn(invalid.headers, 'if-match'), false);
  assert.equal(api.matches('complete', { method: () => 'PATCH', url: () => 'http://example.com/records/3' }), false);
  assert.deepEqual(api.record({ body: { key: 3, name: 'Probe', state: 'done' }, headers: { etag: '"v2"' } }), { id: 3, title: 'Probe', completed: true, proof: '"v2"' });
});
