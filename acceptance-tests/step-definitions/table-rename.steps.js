'use strict';

// Steps for renaming a custom Table (tables-and-fields, #871). Setup and the
// checks of what was carried go through the API; the rename itself and the
// old address are done and read on screen.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TableRenamePage } = require('../support/pages/table-rename-page');

const COLUMNS = [
  { column_name: 'plant_code', label: 'Plant Code', column_type: 'Data' },
  { column_name: 'city', label: 'City', column_type: 'Data' },
];
const enc = encodeURIComponent;

async function importPlant(api, table, code, city, run) {
  await api.call('POST', `/api/table/${enc(table)}:import`, { key_column: 'plant_code', rows: [{ plant_code: String(code), city }], context: { run_id: run } }, [200, 201], `import plant ${code}`);
}

async function plantId(api, table, code) {
  const filters = enc(JSON.stringify([['plant_code', '=', String(code)]]));
  const res = await api.call('GET', `/api/table/${enc(table)}?filters=${filters}&fields=${enc(JSON.stringify(['row_id']))}`, undefined, [200], `find plant ${code}`);
  const [row] = (await res.json()).data;
  assert.ok(row, `no plant ${code} in ${table}`);
  return row.row_id;
}

Given('a table {string} whose plant {int} a person corrected to {string}', async function (table, code, city) {
  await this.withApi(async (api) => {
    await api.createTable({ name: table, module: 'Custom', columns: COLUMNS });
    await importPlant(api, table, code, 'Chenai', `source-${Date.now()}`);
    const rowId = await plantId(api, table, code);
    const row = await api.row(table, rowId);
    await api.call('PATCH', `/api/table/${enc(table)}/${enc(rowId)}`, { city, updated_at: row.updated_at }, [200], 'correct the plant');
  });
  this.plant = { table, code, source: 'Chenai' };
});

Given('the table {string} was renamed to {string}', async function (table, to) {
  await this.withApi(async (api) => {
    await api.removeTableIfPresent(to);
    await api.createTable({ name: table, module: 'Custom', columns: COLUMNS });
    await api.call('POST', `/api/table_def/${enc(table)}/rename`, { to }, [200], `rename ${table}`);
  });
});

When('the System Manager renames the table to {string}', async function (to) {
  await this.withApi((api) => api.removeTableIfPresent(to));
  await new TableRenamePage(await this.asSystemManager()).rename(this.plant.table, to);
});

When('the user opens the old address of {string}', async function (table) {
  this.renamePage = new TableRenamePage(await this.asSystemManager());
  await this.renamePage.openAddress(table);
});

Then('plant {int} of {string} reads {string}, with the correction in its history', async function (code, table, city) {
  await this.withApi(async (api) => {
    const rowId = await plantId(api, table, code);
    assert.equal((await api.row(table, rowId)).city, city);
    const res = await api.call('GET', `/api/activity/${enc(table)}/${enc(rowId)}`, undefined, [200], 'read the history');
    const changes = (await res.json()).versions.map((v) => v.data.changed ?? []).flat();
    assert.ok(changes.some(([field, was, now]) => field === 'city' && was === this.plant.source && now === city), JSON.stringify(changes));
  });
  this.plant.table = table;
});

Then('importing the source again keeps {string}', async function (city) {
  const { table, code, source } = this.plant;
  await this.withApi(async (api) => {
    await importPlant(api, table, code, source, `source-again-${Date.now()}`);
    assert.equal((await api.row(table, await plantId(api, table, code))).city, city);
  });
});

Then('the page says {string} and links to {string}', async function (said, to) {
  const notice = await this.renamePage.renamedNotice();
  assert.ok(notice.text.includes(said), notice.text);
  assert.equal(notice.link, `Open ${to}`);
});
