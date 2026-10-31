'use strict';

// Steps for what a table's list shows and how each person arranges it
// (list-view). "The user" and "a colleague" are people who may read the
// table and are not System Managers.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { SECTION_MAPPING_COLUMNS, sectionMappingTable } = require('../support/fixtures/section-mapping');
const { shelfCheckTable } = require('../support/fixtures/shelf-check');
const { ListPage } = require('../support/pages/list-page');

// The list columns a new Section Mapping starts with: its first seven.
const DEFAULT_LIST = SECTION_MAPPING_COLUMNS.slice(0, 7);

/** Creates the table, lets a reader role read it, and names its readers. */
async function givenTable(world, { def, rows, rowIds }) {
  world.readerRole = await world.withApi(async (api) => {
    await api.createTable(def, rows);
    return api.readerRoleFor(def.name);
  });
  world.table = def.name;
  world.tableColumns = def.columns.map((c) => c.label);
  world.listColumns = def.columns.filter((c) => c.in_list_view).map((c) => c.label);
  world.rowIds = rowIds;
  await world.person('the user', [world.readerRole]);
  await world.person('a colleague', [world.readerRole]);
}

/** That person's list of the scenario's table, opened if it is not already. */
async function listOf(world, who, table = world.table) {
  const list = new ListPage(await world.signedIn(who));
  if (world.openList?.[who] !== table) {
    await list.open(table);
    world.openList = { ...world.openList, [who]: table };
  }
  return list;
}

async function freshListOf(world, who, table = world.table) {
  const list = new ListPage(await world.signedIn(who));
  await list.open(table);
  world.openList = { ...world.openList, [who]: table };
  return list;
}

// ---- Given ----

Given('the table {string} whose list columns are {columns}', async function (table, columns) {
  await givenTable(this, sectionMappingTable(columns, table));
});

Given('a table with no list columns', async function () {
  await givenTable(this, shelfCheckTable());
});

Given('the table {string} with {columns} not in its list', async function (table, columns) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST.filter((c) => !columns.includes(c)), table));
  for (const column of columns) assert.ok(!this.listColumns.includes(column));
});

Given('the list of {string}', async function (table) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST, table));
  await listOf(this, 'the user');
});

Given('the user has hidden a column and sorted the list of a table', async function () {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST));
  const list = await listOf(this, 'the user');
  this.hiddenColumn = 'Floor';
  this.sortedBy = { column: 'Section', dir: 'desc' };
  await list.switchOff(this.hiddenColumn);
  await list.sortBy(this.sortedBy.column, this.sortedBy.dir);
});

Given('the user has switched on {columns} in the list of {string}', async function (columns, table) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST, table));
  const list = await listOf(this, 'the user');
  for (const column of columns) await list.switchOn(column);
});

// ---- When ----

When('the user opens its list', async function () {
  await freshListOf(this, 'the user');
});

When('the user switches on {columns}', async function (columns) {
  const list = await listOf(this, 'the user');
  for (const column of columns) await list.switchOn(column);
});

When('the user switches off every column', async function () {
  const list = await listOf(this, 'the user');
  await list.switchOffEverything();
});

When("the user later reopens the same table's list", async function () {
  const list = new ListPage(await this.signedIn('the user'));
  await list.leave();
  await freshListOf(this, 'the user');
});

When('the user signs out, signs back in and reopens that list', async function () {
  await this.signOutAndBackIn('the user');
  await freshListOf(this, 'the user');
});

// ---- Then ----

Then('the user sees the row ID and those {count} columns', async function (count) {
  assert.equal(this.listColumns.length, count, 'the table does not have that many list columns');
  const list = await listOf(this, 'the user');
  assert.deepEqual(await list.allColumnLabels(), ['Row ID', ...this.listColumns]);
});

Then("the user sees the row ID and the table's first two columns", async function () {
  const list = await listOf(this, 'the user');
  assert.deepEqual(await list.allColumnLabels(), ['Row ID', ...this.tableColumns.slice(0, 2)]);
});

Then("the user's list shows {columns}", async function (columns) {
  const shown = await (await listOf(this, 'the user')).columnLabels();
  for (const column of columns) assert.ok(shown.includes(column), `${column} is not in the list: ${shown.join(', ')}`);
});

Then("a colleague's list of {string} does not show {columns}", async function (table, columns) {
  const shown = await (await freshListOf(this, 'a colleague', table)).columnLabels();
  for (const column of columns) assert.ok(!shown.includes(column), `${column} is in the list: ${shown.join(', ')}`);
});

Then("the user's list still shows each row's ID", async function () {
  const list = await listOf(this, 'the user');
  const rows = await list.rowTexts();
  for (const id of this.rowIds)
    assert.ok(rows.some((text) => text.includes(id)), `no row shows the ID ${id}; rows read: ${JSON.stringify(rows)}`);
});

Then('the column is still hidden', async function () {
  const shown = await (await listOf(this, 'the user')).columnLabels();
  assert.ok(!shown.includes(this.hiddenColumn), `${this.hiddenColumn} is in the list: ${shown.join(', ')}`);
});

Then('the list is still sorted the way they left it', async function () {
  const list = await listOf(this, 'the user');
  const { column, dir } = this.sortedBy;
  const values = await list.columnValuesOnceSorted(column, dir);
  assert.deepEqual(await list.sorting(), this.sortedBy);
  const expected = [...values].sort((a, b) => (dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
  assert.ok(new Set(values).size > 1, `too few distinct ${column} values to see an order: ${values.join(', ')}`);
  assert.deepEqual(values, expected, `the rows are not sorted by ${column} ${dir}`);
});

Then('{columns} still shows', async function (columns) {
  const shown = await (await listOf(this, 'the user')).columnLabels();
  for (const column of columns) assert.ok(shown.includes(column), `${column} is not in the list: ${shown.join(', ')}`);
});
