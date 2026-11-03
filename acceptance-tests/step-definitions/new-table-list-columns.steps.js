'use strict';

// Steps for a new table's list columns (tables-and-fields), and the list
// assertions later list-view scenarios reuse.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { SECTION_MAPPING_COLUMNS, sheet, toCsv } = require('../support/fixtures/section-mapping');
const { ImportWizardPage } = require('../support/pages/import-wizard-page');
const { TableBuilderPage } = require('../support/pages/table-builder-page');
const { ListPage } = require('../support/pages/list-page');
const { FormPage } = require('../support/pages/form-page');

// ---- Given: what the user starts from ----

Given('a sheet with the columns {columns}', function (columns) {
  this.sheet = sheet(columns);
});

Given('the same ten-column sheet', function () {
  this.sheet = sheet(SECTION_MAPPING_COLUMNS);
});

Given('the user is building a table by typing the same ten columns', async function () {
  this.sheet = sheet(SECTION_MAPPING_COLUMNS);
  await this.removeTableIfPresent(this.sheet.tableName);
  const builder = new TableBuilderPage(await this.asSystemManager());
  await builder.open();
  await builder.name(this.sheet.tableName);
  await builder.typeColumns(this.sheet.columns);
});

// ---- When: creating the table ----

async function importAsNewTable(world, name, { leaveOut = [], tickAll = false } = {}) {
  await world.removeTableIfPresent(name);
  const wizard = new ImportWizardPage(await world.asSystemManager());
  await wizard.open();
  await wizard.dropCsv(world.sheet.fileName, toCsv(world.sheet));
  await wizard.asNewTable(name);
  for (const column of leaveOut) await wizard.leaveOut(column);
  if (tickAll) await wizard.tickAllInList();
  await wizard.importAll();
  world.table = name;
}

When(
  'the user imports it as a new table {string} without changing which columns are in the list',
  async function (name) {
    await importAsNewTable(this, name);
  },
);

When('the user leaves {columns} out and imports it as a new table', async function (columns) {
  await importAsNewTable(this, this.sheet.tableName, { leaveOut: columns });
});

When(
  'the user switches every column into the list at once and imports it as a new table',
  async function () {
    await importAsNewTable(this, this.sheet.tableName, { tickAll: true });
  },
);

When('the user creates it without changing which columns are in the list', async function () {
  const builder = new TableBuilderPage(await this.asSystemManager());
  await builder.create();
  this.table = this.sheet.tableName;
});

// ---- Then: what the list shows ----

async function listColumnsOf(world, table) {
  const list = new ListPage(await world.asSystemManager());
  await list.open(table);
  return list.columnLabels();
}

Then('the list of {string} shows {columns}', async function (table, columns) {
  assert.deepEqual(await listColumnsOf(this, table), columns);
});

Then('its/the list shows {columns}', async function (columns) {
  assert.deepEqual(await listColumnsOf(this, this.table), columns);
});

Then('the list shows all {count} columns', async function (count) {
  const shown = await listColumnsOf(this, this.table);
  assert.equal(this.sheet.columns.length, count, 'the sheet does not have that many columns');
  assert.deepEqual(shown, this.sheet.columns);
});

Then('{columns} is not in the list', async function (columns) {
  const shown = await listColumnsOf(this, this.table);
  for (const column of columns) assert.ok(!shown.includes(column), `${column} is in the list: ${shown.join(', ')}`);
});

Then('{columns} is in the list as the {ordinal} column', async function (columns, position) {
  assert.equal(columns.length, 1, 'name one column');
  const shown = await listColumnsOf(this, this.table);
  assert.equal(shown[position - 1], columns[0], `the list shows ${shown.join(', ')}`);
});

Then("{columns} show(s) only on each/a row's form", async function (columns) {
  const page = await this.actor();
  const list = new ListPage(page);
  await list.open(this.table);
  const shown = await list.columnLabels();
  for (const column of columns) assert.ok(!shown.includes(column), `${column} is in the list: ${shown.join(', ')}`);
  await list.openFirstRow();
  const form = new FormPage(page);
  for (const column of columns) assert.ok(await form.showsField(column), `the row's form has no ${column}`);
});
