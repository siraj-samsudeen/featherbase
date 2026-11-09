'use strict';

// Steps for what a table's list shows that capabilities still on cucumber
// share (tables-and-fields). list-view itself runs as Vitest tests (#1070,
// apps/web/test/scenarios/list-view.test.tsx). "The user" and "a colleague"
// are people who may read the table and are not System Managers.

const assert = require('node:assert/strict');
const { Given, When } = require('@cucumber/cucumber');
const { sectionMappingTable } = require('../support/fixtures/section-mapping');
const { DEFAULT_LIST, givenTable, freshListOf } = require('../support/lists');

Given('the table {string} with {columns} not in its list', async function (table, columns) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST.filter((c) => !columns.includes(c)), table));
  for (const column of columns) assert.ok(!this.listColumns.includes(column));
});

When('the user opens its list', async function () {
  await freshListOf(this, 'the user');
});
