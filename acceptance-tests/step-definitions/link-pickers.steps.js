'use strict';

// Steps for picking a linked row by its name: a list's quick filter on a link
// column (list-view) and a form's link field (core-forms). Orders each link to
// a customer; customers are titled by their name and their ids are not their
// names, so a search by id would find nothing. Made-up rows only.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { ListPage } = require('../support/pages/list-page');
const { LinkPicker } = require('../support/pages/link-picker');

const CUSTOMERS = 'Pick Customer';
const ORDERS = 'Pick Order';

function quickCustomerFilter(page) {
  return new LinkPicker(page, page.getByTestId('std-filter-customer'), 'customer');
}

function formCustomerField(page) {
  return new LinkPicker(page, page.getByTestId('form-view').getByLabel('Customer', { exact: true }), 'customer');
}

async function waitForOrders(page, items) {
  const list = new ListPage(page);
  const want = [...items].sort().join(', ');
  const deadline = Date.now() + 10_000;
  let shown = [];
  for (;;) {
    shown = (await list.columnValues('Item')).map((t) => t.trim()).sort();
    if (shown.join(', ') === want || Date.now() > deadline) break;
    await page.waitForTimeout(150);
  }
  assert.equal(shown.join(', '), want, 'the orders shown');
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

async function openFilteredOrders(world, customer) {
  const page = await world.actor();
  const filters = JSON.stringify([['customer', '=', world.customers[customer]]]);
  await page.goto(`/featherbase/admin/${encodeURIComponent(ORDERS)}?filters=${encodeURIComponent(filters)}`);
  await new ListPage(page).headers().first().waitFor();
  return page;
}

Given('the orders list filtered to the customer {string}', async function (customer) {
  const page = await openFilteredOrders(this, customer);
  await waitForOrders(page, this.ordersOf[customer]);
});

// ---- When ----

async function typeIntoQuickFilter(world, text) {
  const page = await world.actor();
  await new ListPage(page).open(ORDERS);
  const filter = quickCustomerFilter(page);
  await filter.type(text);
  return filter;
}

When("the user types {string} into the orders list's quick customer filter and picks {string}", async function (text, name) {
  await (await typeIntoQuickFilter(this, text)).pick(name);
});

When("the user types {string} into the orders list's quick customer filter", async function (text) {
  this.picker = await typeIntoQuickFilter(this, text);
});

When('the user opens a link to the orders list filtered to the customer {string}', async function (customer) {
  await openFilteredOrders(this, customer);
});

When('the user clears the quick customer filter', async function () {
  const page = await this.actor();
  await page.getByRole('button', { name: /clear the customer filter/i }).click();
});

When("the user types {string} into a new order's customer and picks {string}", async function (text, name) {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/${encodeURIComponent(ORDERS)}/new`);
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

Then('the user sees only the orders from {string}', async function (customer) {
  await waitForOrders(await this.actor(), this.ordersOf[customer]);
});

Then('the user is offered {string} and no way to create a customer', async function (name) {
  assert.deepEqual(await this.picker.offered(), [name]);
  assert.equal(await this.picker.offersToCreate(), false, 'the filter offers to create a customer');
});

Then('the user sees the quick customer filter reading {string}', async function (name) {
  const filter = quickCustomerFilter(await this.actor());
  const deadline = Date.now() + 10_000;
  let reads = '';
  while (Date.now() < deadline && (reads = await filter.reads().catch(() => '')) !== name) await filter.page.waitForTimeout(150);
  assert.equal(reads, name);
});

Then('the user sees the orders from both {string} and {string}', async function (first, second) {
  await waitForOrders(await this.actor(), [...this.ordersOf[first], ...this.ordersOf[second]]);
});

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
