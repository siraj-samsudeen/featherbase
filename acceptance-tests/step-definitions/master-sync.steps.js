'use strict';

// #927: keep a master Table in step with a copied warehouse table. Synthetic
// rows only, in the stack's stand-in warehouse. The ticket app is the
// ticket-sink test app, which keeps each ticket the sync asks for.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { Given, When, Then } = require('@cucumber/cucumber');
const { changeStandin, restartAcceptance, useInstanceToken, acceptanceSql, REPO_ROOT } = require('../support/stack');

let sinkDiscovered = false;
const path = name => `/api/table/${encodeURIComponent(name)}`;

async function call(world, method, url, data, expected = [200, 201]) {
  let body;
  await world.withApi(async api => { const res = await api.call(method, url, data, expected, `${method} ${url}`); body = await res.json().catch(() => null); });
  return body;
}

Given("StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row", async function () {
  // Discovered again whenever another scenario reset the stack without it.
  const known = await call(this, 'GET', '/api/apps');
  if (!sinkDiscovered || ![...(known.available ?? []), ...(known.installed ?? [])].some(app => app.name === 'ticketsink')) {
    await restartAcceptance({ FEATHERBASE_APP_PATHS: JSON.stringify([resolve(REPO_ROOT, 'test-apps/ticket-sink')]) });
    sinkDiscovered = true;
  }
  const tag = randomUUID().slice(0, 6);
  this.sync = { tag, source: `staff_${tag}`, copy: `Staff Copy ${tag}`, person: `Sync Person ${tag}`, link: `Sync Link ${tag}` };
  const s = this.sync;
  changeStandin('sales', [
    `create or replace table ${s.source} (emp_id varchar, name varchar, phone varchar)`,
    `insert into ${s.source} values ('E1', 'Asha', '111')`,
  ]);
  const dataSource = `acc-sync-${tag}`;
  s.dataSource = dataSource;
  await useInstanceToken();
  await call(this, 'POST', '/api/table/Data%20Source:motherduck_connect', { name: dataSource, databases: ['sales'] });
  await call(this, 'POST', `/api/table/Data%20Source/${dataSource}:refresh_tables`, { database: 'sales' });
  await call(this, 'POST', `/api/table/Data%20Source/${dataSource}:copy_create`, { database: 'sales', schema: 'main', table: s.source, name: s.copy, key: 'emp_id',
    columns: ['emp_id', 'name', 'phone'].map(c => ({ source: c, column_name: c })) });
  await this.withApi(async api => {
    await api.createTable({ name: s.person, id_pattern: 'prompt', columns: ['full_name', 'phone', 'employment_status'].map(column_name => ({ column_name, column_type: 'Data' })) });
    await api.createTable({ name: s.link, columns: ['source_system', 'source_key', 'person'].map(column_name => ({ column_name, column_type: 'Data' })) });
    await api.saveRow(s.person, { row_id: 'P1', full_name: 'Asha', phone: '111', employment_status: 'Active' });
    await api.saveRow(s.link, { source_system: 'StyleHR', source_key: 'E1', person: 'P1' });
    const apps = await (await api.call('GET', '/api/apps', undefined, [200], 'apps')).json();
    if (!apps.installed.some(app => app.name === 'ticketsink')) await api.call('POST', '/api/install_app', { name: 'ticketsink' }, [201, 417], 'install ticket sink');
  });
  await call(this, 'POST', `${path(s.copy)}:set_master_sync`, { rule: {
    master_table: s.person, source_system: 'StyleHR',
    link: { table: s.link, system_column: 'source_system', key_column: 'source_key', master_column: 'person' },
    columns: { full_name: { source: 'name', owner: 'source' }, phone: { source: 'phone', owner: 'source' } },
    inactive: { column: 'employment_status', value: 'Inactive' },
    tickets: { app: 'ticketsink', type: 'source_change', source_system: 'StyleHR' },
  } });
  await call(this, 'POST', `${path(s.copy)}:master_sync_run`, {});
});

async function refresh(world) {
  const s = world.sync;
  await call(world, 'POST', `/api/table/Data%20Source/${s.dataSource}:refresh_tables`, { database: 'sales' });
  // Copy again alone: it brings the master Table in step too.
  world.sync.last = await call(world, 'POST', `${path(s.copy)}:copy_again`, {});
}
const asha = world => call(world, 'GET', `${path(world.sync.person)}/P1`);
const tickets = async world => (await acceptanceSql('select payload from ticketsink.ticket'))
  .map(r => JSON.parse(r.payload)).filter(p => p.title.includes(world.sync.person));

When('StyleHR changes Asha\'s name to {string} and the copy is refreshed', async function (name) {
  changeStandin('sales', [`update ${this.sync.source} set name = '${name}' where emp_id = 'E1'`]);
  await refresh(this);
});
When('a person changes Asha\'s phone in Featherbase and the copy is refreshed twice', async function () {
  const row = await asha(this);
  await this.withApi(api => api.call('POST', '/api/save_row', { table: this.sync.person, row: { row_id: 'P1', updated_at: row.updated_at, phone: '999' } }, [200, 201], 'edit phone'));
  await refresh(this);
  await refresh(this);
});
When('StyleHR adds Devan and the copy is refreshed', async function () {
  changeStandin('sales', [`insert into ${this.sync.source} values ('E2', 'Devan', '222')`]);
  this.sinkBefore = (await acceptanceSql('select count(*)::int as n from ticketsink.ticket'))[0].n;
  await refresh(this);
});
When('StyleHR removes Asha and the copy is refreshed', async function () {
  changeStandin('sales', [`delete from ${this.sync.source} where emp_id = 'E1'`]);
  await refresh(this);
});

Then('Asha\'s Person row reads {string}, and its history says the change came from StyleHR', async function (name) {
  assert.equal((await asha(this)).full_name, name);
  const [version] = await acceptanceSql('select data from featherbase.version where ref_table = $1 and ref_name = $2 order by created_at desc limit 1', [this.sync.person, 'P1']);
  assert.equal(version.data.synced_from, 'StyleHR');
});
Then('Asha\'s phone is kept, and one ticket asks whether StyleHR should be fixed', async function () {
  assert.equal((await asha(this)).phone, '999');
  const asked = (await tickets(this)).filter(p => p.details.record_key === 'P1' && /Should the source be fixed/.test(p.original));
  assert.equal(asked.length, 1);
});
Then('a ticket asks to create or link Devan, and no Person row is linked to him', async function () {
  const [after] = await acceptanceSql('select count(*)::int as n from ticketsink.ticket');
  assert.equal(after.n, this.sinkBefore + 1);
  const [newest] = await acceptanceSql('select payload from ticketsink.ticket order by created_at desc limit 1');
  const payload = JSON.parse(newest.payload);
  assert.equal(payload.details.record_key, 'E2');
  assert.match(payload.original, /no link/);
  const filters = encodeURIComponent(JSON.stringify([['source_key', '=', 'E2']]));
  assert.deepEqual((await call(this, 'GET', `${path(this.sync.link)}?filters=${filters}`)).data, []);
});
Then('Asha\'s Person row is marked inactive and is still there', async function () {
  const row = await asha(this);
  assert.equal(row.employment_status, 'Inactive');
  assert.equal(row.full_name, 'Asha');
});

