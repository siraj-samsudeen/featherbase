'use strict';

// Steps for a table called "Site" (tables-and-fields, #906). The table and
// its row are made through the API; the row is read on screen, and the host
// registry (public.site) straight from the acceptance database.

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { ListPage } = require('../support/pages/list-page');
const { acceptanceSql } = require('../support/stack');

const registry = () => acceptanceSql('select * from public.site order by 1');

After(async function () {
  if (this.siteTable) await this.withApi((api) => api.removeTableIfPresent(this.siteTable));
});

Given('no table is called {string}', async function (table) {
  await this.withApi((api) => api.removeTableIfPresent(table));
  this.registryBefore = await registry();
});

When('the user creates a table {string} and adds the site {string}', async function (table, site) {
  this.siteTable = table;
  await this.withApi((api) => api.createTable(
    { name: table, module: 'Custom', columns: [{ column_name: 'site_name', label: 'Site Name', column_type: 'Data', in_list_view: true }] },
    [{ site_name: site }],
  ));
});

Then('the table shows {string}', async function (site) {
  const list = new ListPage(await this.asSystemManager());
  await list.open(this.siteTable);
  // Rows arrive after the headers; give them a few seconds to show.
  let shown = [];
  for (const start = Date.now(); Date.now() - start < 5_000 && !shown.length; await new Promise((r) => setTimeout(r, 200)))
    shown = await list.columnValues('Site Name');
  assert.deepEqual(shown, [site]);
});

Then("the platform's record of its web addresses is unchanged", async function () {
  assert.deepEqual(await registry(), this.registryBefore);
});
