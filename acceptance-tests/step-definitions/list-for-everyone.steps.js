'use strict';

// Steps for who may shape a table, and choosing which columns its list shows
// for everyone (tables-and-fields). "A System Manager" and "a builder" are
// the seeded System Manager; "the user" and "a colleague" are readers of the
// table who are not.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { sectionMappingTable } = require('../support/fixtures/section-mapping');
const { ColumnEditorPage } = require('../support/pages/column-editor-page');
const { DEFAULT_LIST, givenTable, freshListOf, listOf } = require('../support/lists');

// A table the platform's own migrations create and depend on.
const PLATFORM_TABLE = 'Import Log';

// ---- Given ----

Given('the user is not a System Manager', async function () {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST));
});

Given('a table the platform depends on', function () {
  this.table = PLATFORM_TABLE;
});

// ---- When ----

When('a System Manager switches {columns} into its list', async function (columns) {
  const editor = new ColumnEditorPage(await this.asSystemManager());
  await editor.open(this.table);
  for (const column of columns) await editor.putInList(column);
});

When('the user opens the list of {string}', async function (table) {
  assert.equal(table, this.table, `the scenario's readers were given ${this.table}, not ${table}`);
  await freshListOf(this, 'the user');
});

When('a builder opens its Columns screen', async function () {
  this.columnEditor = new ColumnEditorPage(await this.asSystemManager());
  await this.columnEditor.open(this.table);
});

// ---- Then ----

Then('a colleague opening the list of {string} sees {columns}', async function (table, columns) {
  const shown = await (await freshListOf(this, 'a colleague', table)).columnLabels();
  for (const column of columns) assert.ok(shown.includes(column), `${column} is not in the list: ${shown.join(', ')}`);
});

Then("no row's values have changed", async function () {
  const stored = await this.withApi((api) =>
    Promise.all(this.givenRows.map((row) => api.row(this.table, row.row_id))),
  );
  this.givenRows.forEach((given, i) => {
    const now = Object.fromEntries(Object.keys(given).map((key) => [key, stored[i][key]]));
    assert.deepEqual(now, given, `row ${given.row_id} has changed`);
  });
});

Then('the user can change which columns they see themselves', async function () {
  const list = await listOf(this, 'the user');
  const hidden = this.tableColumns.find((c) => !this.listColumns.includes(c));
  await list.switchOn(hidden);
  assert.ok((await list.columnLabels()).includes(hidden), `switching on ${hidden} did not show it`);
  await list.switchOff(hidden);
  assert.ok(!(await list.columnLabels()).includes(hidden), `switching off ${hidden} did not hide it`);
});

Then('nothing there changes the list for anyone else', async function () {
  const list = await listOf(this, 'the user');
  assert.equal(await list.offersEditColumns(), false, 'the list offers "Edit columns"');
  assert.equal(await list.offersMakeDefault(), false, 'the "Show columns" menu offers to make a default for everyone');
});

Then("it says the table's columns belong to the platform", async function () {
  const notice = await this.columnEditor.platformNotice();
  assert.ok(notice?.includes('belong to the platform'), `the Columns screen says: ${notice ?? 'nothing about it'}`);
});

Then('it offers no way to add or rename one', async function () {
  assert.deepEqual(await this.columnEditor.waysToAddOrRename(), []);
});
