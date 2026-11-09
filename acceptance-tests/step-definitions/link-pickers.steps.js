'use strict';

// Steps for picking a linked row by its name in a form's link field
// (core-forms). The list's quick filter (list-view) runs as Vitest tests
// (#1070). Orders each link to
// a customer; customers are titled by their name and their ids are not their
// names, so a search by id would find nothing. Made-up rows only.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { LinkPicker } = require('../support/pages/link-picker');
const { tableHref } = require('../support/addresses');

const CUSTOMERS = 'Pick Customer';
const ORDERS = 'Pick Order';

function formCustomerField(page) {
  return new LinkPicker(page, page.getByTestId('form-view').getByLabel('Customer', { exact: true }), 'customer');
}

// ---- Given ----

Given('orders from the customers {string} and {string}', async function (first, second) {
  this.customers = { [first]: 'cust-1', [second]: 'cust-2' };
  this.ordersOf = { [first]: ['Widgets', 'Sprockets'], [second]: ['Gears'] };
  await this.withApi(async (api) => {
    await api.removeTableIfPresent(ORDERS);
    await api.createTable(
      {
        name: CUSTOMERS, id_pattern: 'prompt', title_column: 'customer_name',
        columns: [{ column_name: 'customer_name', label: 'Customer Name', column_type: 'Data', in_list_view: true }],
      },
      [{ row_id: 'cust-1', customer_name: first }, { row_id: 'cust-2', customer_name: second }],
    );
    await api.createTable(
      {
        name: ORDERS, id_pattern: 'PKO-.###',
        columns: [
          { column_name: 'item', label: 'Item', column_type: 'Data', in_list_view: true },
          { column_name: 'customer', label: 'Customer', column_type: 'Reference', reference_table: CUSTOMERS, in_list_view: true },
        ],
      },
      [
        { item: 'Widgets', customer: 'cust-1' },
        { item: 'Sprockets', customer: 'cust-1' },
        { item: 'Gears', customer: 'cust-2' },
      ],
    );
  });
});

// ---- When ----

When("the user types {string} into a new order's customer and picks {string}", async function (text, name) {
  const page = await this.actor();
  await page.goto(`${tableHref(ORDERS)}/new`);
  await page.getByTestId('form-view').waitFor();
  const field = formCustomerField(page);
  await field.type(text);
  this.offered = await field.offered();
  await field.pick(name);
  await page.getByTestId('form-view').getByLabel('Item', { exact: true }).fill('Bolts');
  const saved = page.waitForResponse((r) => r.url().includes('/api/') && r.request().method() === 'POST' && r.status() < 300);
  await page.getByTestId('form-save').click();
  await saved;
  await page.waitForURL((url) => !url.pathname.endsWith('/new'), { timeout: 10_000 });
});

// ---- Then ----

Then('the user was offered only {string}', function (name) {
  assert.deepEqual(this.offered, [name]);
});

Then("the user sees the saved order's customer as {string}", async function (name) {
  const field = formCustomerField(await this.actor());
  const deadline = Date.now() + 10_000;
  let reads = '';
  while (Date.now() < deadline && (reads = await field.reads().catch(() => '')) !== name) await field.page.waitForTimeout(150);
  assert.equal(reads, name);
});
