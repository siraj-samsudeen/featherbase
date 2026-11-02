'use strict';

// Steps for what a table's list shows and how each person arranges it
// (list-view). "The user" and "a colleague" are people who may read the
// table and are not System Managers.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { sectionMappingTable } = require('../support/fixtures/section-mapping');
const { shelfCheckTable } = require('../support/fixtures/shelf-check');
const { ListPage } = require('../support/pages/list-page');
const { DEFAULT_LIST, givenTable, listOf, freshListOf, systemManagersList } = require('../support/lists');

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

Given('a System Manager has switched on {columns} in the list of {string}', async function (columns, table) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST, table));
  const list = await systemManagersList(this);
  for (const column of columns) await list.switchOn(column);
  this.systemManagersList = list;
});

Given('a colleague has never changed their own view of it', async function () {
  // givenTable names a colleague created fresh for this scenario: they have
  // no saved arrangement of any list.
  assert.ok(this.people.has('a colleague'));
});

Given(
  'a colleague has switched off {columns} and switched on {columns} in the list of {string}',
  async function (off, on, table) {
    await givenTable(this, sectionMappingTable(DEFAULT_LIST, table));
    const list = await listOf(this, 'a colleague');
    for (const column of off) await list.switchOff(column);
    for (const column of on) await list.switchOn(column);
  },
);

// ---- When ----

When('the System Manager makes their view the default for everyone', async function () {
  await this.systemManagersList.makeDefaultForEveryone();
});

When(
  'a System Manager makes a default that includes {columns} and leaves out {columns}',
  async function (included, left) {
    const list = await systemManagersList(this);
    for (const column of included) await list.switchOn(column);
    for (const column of left) await list.switchOff(column);
    await list.makeDefaultForEveryone();
  },
);

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

Then("the colleague's list (still )shows {columns}", async function (columns) {
  const shown = await (await freshListOf(this, 'a colleague')).columnLabels();
  for (const column of columns) assert.ok(shown.includes(column), `${column} is not in the list: ${shown.join(', ')}`);
});

Then("the colleague's list still does not show {columns}", async function (columns) {
  const shown = await (await freshListOf(this, 'a colleague')).columnLabels();
  for (const column of columns) assert.ok(!shown.includes(column), `${column} is in the list: ${shown.join(', ')}`);
});
