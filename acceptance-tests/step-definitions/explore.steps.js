'use strict';

// Steps for finding Explore's starting table and reading its rows
// (search-and-explore). "The user" is the seeded System Manager.

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('playwright/test');
const { ExplorePage } = require('../support/pages/explore-page');
const { DrillPane } = require('../support/pages/drill-pane');
const { seedPurchasing, dropPurchasing } = require('../support/organisation');

Given('a table of suppliers and a table of purchases, each purchase from a supplier', async function () {
  await this.withApi(async (api) => {
    await dropPurchasing(api);
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

// ---- Narrowing by clicking, and opening a row in the drill pane (#910) ----
// Acme's two orders have three lines worth 350; Bolt Co's one order a line worth 999.

const WAIT = 10_000;

async function exploreSuppliersAndOrders(world) {
  await world.withApi((api) => seedPurchasing(api));
  world.seededPurchasing = true;
  world.explore = new ExplorePage(await world.actor());
  await world.explore.open();
  await world.explore.startFrom('Supplier');
  await world.explore.addStep(2, 'Purchase Order');
}

// Explore's Supplier is another feature's Supplier too; leave no orders linked to it.
After(async function () {
  if (this.seededPurchasing) await this.withApi((api) => dropPurchasing(api));
});

Given('the user starts Explore from Supplier and adds Purchase Order', async function () {
  await exploreSuppliersAndOrders(this);
});

When('the user clicks one supplier and then adds PO Line', async function () {
  await this.explore.clickRow(1, 'Acme');
  await this.explore.addStep(3, 'PO Line');
});

Then("Purchase Order narrows to that supplier's orders", async function () {
  await expect(this.explore.count(2)).toHaveText('2', { timeout: WAIT });
  const rows = await this.explore.rowsOf(2);
  assert.ok(rows.every((r) => r.includes('Acme')), `the orders read ${JSON.stringify(rows)}`);
});

Then("PO Line narrows to those orders' lines, with an accurate count and sum at every stage", async function () {
  await expect(this.explore.count(1)).toHaveText('2', { timeout: WAIT });
  await expect(this.explore.count(2)).toHaveText('2', { timeout: WAIT });
  await expect(this.explore.count(3)).toHaveText('3', { timeout: WAIT });
  await expect(this.explore.sum(3)).toContainText('350', { timeout: WAIT });
});

Given("the user has Explore narrowed to one supplier's orders", async function () {
  await exploreSuppliersAndOrders(this);
  await this.explore.clickRow(1, 'Acme');
  await expect(this.explore.count(2)).toHaveText('2', { timeout: WAIT });
});

When('the user opens one of those orders', async function () {
  await this.explore.clickRow(2, 'Acme order 1');
});

Then('it shows in the drill pane', async function () {
  await new DrillPane(this.explore.page).shows('Acme order 1');
});

Then('the supplier stays selected in Explore', async function () {
  await expect(this.explore.chips()).toHaveCount(1);
  await expect(this.explore.chips().first()).toContainText('Supplier');
  await expect(this.explore.selectedRows(1)).toContainText('Acme');
});
