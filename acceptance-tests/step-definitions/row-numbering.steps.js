'use strict';

// Steps for how a table numbers its rows (naming-and-numbering, #855).
// Setup and the rows a scenario adds go through the API; the builder's
// promise is read from the builder itself.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TableBuilderPage } = require('../support/pages/table-builder-page');

const COLUMNS = [{ column_name: 'title', label: 'Title', column_type: 'Data' }];

async function createTable(world, name, idPattern) {
  const def = { name, module: 'Custom', columns: COLUMNS };
  if (idPattern) def.id_pattern = idPattern;
  await world.withApi((api) => api.createTable(def));
  world.tables = [...(world.tables ?? []), name];
  world.added = [];
}

async function addRow(world, table) {
  const row = await world.withApi((api) => api.saveRow(table, { title: 'a row' }));
  world.added.push(row.row_id);
  return row.row_id;
}

// ---- Given: the table a scenario starts from ----

Given('the user creates a table {string} without choosing how its rows are named', async function (name) {
  await createTable(this, name);
});

Given(
  'two tables {string} and {string} both named by a series with the prefix {string} and three digits',
  async function (first, second, prefix) {
    for (const name of [first, second]) await createTable(this, name, `${prefix}.###`);
  },
);

Given('a table {string} whose rows are numbered 1, 2, 3', async function (name) {
  await createTable(this, name, 'integer');
});

Given('the user has added bin 1 and imported a bin with the id 2', async function () {
  const [table] = this.tables;
  assert.equal(await addRow(this, table), '1');
  // An import supplies its own ids through the same create the API offers.
  await this.withApi((api) =>
    api.call('POST', `/api/table/${encodeURIComponent(table)}`, { row_id: '2', title: 'imported' }, [201], 'import bin 2'),
  );
});

Given('the user is building a table {string}', async function (name) {
  await this.removeTableIfPresent(name);
  this.builder = new TableBuilderPage(await this.asSystemManager());
  await this.builder.open();
  await this.builder.name(name);
});

// ---- When: adding rows ----

When('the user adds three plants', async function () {
  for (let i = 0; i < 3; i++) await addRow(this, this.tables[0]);
});

When('the user adds a store to each', async function () {
  for (const table of this.tables) await addRow(this, table);
});

When('the user adds another bin', async function () {
  await addRow(this, this.tables[0]);
});

// ---- Then: the numbers they got ----

Then('the plants are numbered 1, 2 and 3', function () {
  assert.deepEqual(this.added, ['1', '2', '3']);
});

Then('each store is numbered STORE-001', function () {
  assert.deepEqual(this.added, ['STORE-001', 'STORE-001']);
});

Then('it is numbered 3', function () {
  assert.equal(this.added.at(-1), '3');
});

Then('the builder says its rows will be numbered 1, 2, 3', async function () {
  const said = await this.builder.namingPreview();
  assert.match(said, /numbered 1, 2, 3/, `the builder says: ${said}`);
});
