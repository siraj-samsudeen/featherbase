'use strict';

// Steps for finding Explore's starting table and reading its rows
// (search-and-explore). "The user" is the seeded System Manager.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { ExplorePage } = require('../support/pages/explore-page');

Given('a table of suppliers and a table of purchases, each purchase from a supplier', async function () {
  await this.withApi(async (api) => {
    await api.removeTableIfPresent('Purchase');
    await api.createTable({
      name: 'Supplier', id_pattern: 'prompt', title_column: 'title',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    }, [{ row_id: 'sup-1', title: 'Bolt Co' }]);
    await api.createTable({
      name: 'Purchase', id_pattern: 'prompt', title_column: 'title',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'supplier', column_type: 'Reference', reference_table: 'Supplier', in_list_view: true },
      ],
    }, [{ row_id: 'po-1', title: 'First order', supplier: 'sup-1' }]);
  });
});

Given('the purchases are from the supplier {string}', async function (name) {
  await this.withApi(async (api) => {
    const { updated_at } = await api.row('Supplier', 'sup-1');
    await api.call('PATCH', '/api/table/Supplier/sup-1', { title: name, updated_at }, [200], 'rename the supplier');
  });
  this.supplier = name;
});

When("the user types {string} in Explore's table search and presses Enter", async function (text) {
  this.explore = new ExplorePage(await this.actor());
  await this.explore.open();
  await this.explore.searchAndStart(text);
});

Then('Explore starts from the purchases', async function () {
  assert.equal(await this.explore.startingTable(), 'Purchase');
});

Then('each purchase shows {string}', async function (title) {
  const rows = await this.explore.firstPaneRows();
  await this.explore.page.getByTestId('explore-pane1').getByText(title, { exact: true }).first().waitFor({ timeout: 10_000 })
    .catch(() => assert.fail(`the purchases read ${JSON.stringify(rows)}, not "${title}"`));
  for (const row of await this.explore.firstPaneRows()) assert.ok(row.includes(title), `a purchase reads "${row}"`);
});
