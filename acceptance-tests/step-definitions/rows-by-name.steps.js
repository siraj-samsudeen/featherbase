'use strict';

// Steps for rows read by their name, not their id, in a list (list-view) and in
// the relationship map's row lists (search-and-explore). The orders and
// customers come from "orders from the customers … and …" (link-pickers.steps.js):
// customers are titled by their name, orders are not titled. Made-up rows only.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { ListPage } = require('../support/pages/list-page');
const { RelationMapPage } = require('../support/pages/relation-map-page');
const { tableHref } = require('../support/addresses');

// The tables "orders from the customers … and …" creates.
const CUSTOMERS = 'Pick Customer';
const ORDERS = 'Pick Order';

/** Polls `read` until `ok` holds or ten seconds pass; returns the last read. */
async function eventually(page, read, ok) {
  const deadline = Date.now() + 10_000;
  let last;
  for (;;) {
    last = await read().catch(() => undefined);
    if ((last !== undefined && ok(last)) || Date.now() > deadline) return last;
    await page.waitForTimeout(150);
  }
}

async function openList(world, table) {
  const page = await world.actor();
  const list = new ListPage(page);
  await list.open(table);
  return list;
}

/** The row of the orders list whose Item is `item`. */
function orderRow(list, item) {
  return list.rows().filter({ has: list.page.locator('[data-testid="cell-item"]', { hasText: item }) }).first();
}

// ---- Given ----

Given('a customer {string} with no name, with the order {string}', async function (rowId, item) {
  await this.withApi(async (api) => {
    await api.call('POST', `/api/table/${encodeURIComponent(CUSTOMERS)}`, { row_id: rowId, customer_name: '' }, [201], 'add the nameless customer');
    await api.call('POST', `/api/table/${encodeURIComponent(ORDERS)}`, { item, customer: rowId }, [201], 'add its order');
  });
  this.namelessCustomer = rowId;
});

// ---- When ----

When('the user opens the customers list', async function () {
  this.list = await openList(this, CUSTOMERS);
});

When('the user switches off every column of the customers list', async function () {
  this.list = await openList(this, CUSTOMERS);
  await this.list.switchOffEverything();
});

When('the user opens the orders list', async function () {
  this.list = await openList(this, ORDERS);
});

When('the user opens the orders list and clicks the customer of the order {string}', async function (item) {
  this.list = await openList(this, ORDERS);
  const link = orderRow(this.list, item).locator('[data-testid="cell-customer"] a');
  await link.waitFor({ timeout: 10_000 });
  await link.click();
});

When('the user opens a link to the orders list filtered to the item {string}', async function (item) {
  const page = await this.actor();
  const filters = JSON.stringify([['item', '=', item]]);
  await page.goto(`${tableHref(ORDERS)}?filters=${encodeURIComponent(filters)}`);
  await new ListPage(page).headers().first().waitFor();
});

When('the user comes back to the whole orders list', async function () {
  this.list = await openList(this, ORDERS);
});

When("the user opens that chore's relationship map and clicks {string} in the listed row", async function (title) {
  this.map = new RelationMapPage(await this.actor());
  await this.map.open('Chore', 'chore-1');
  const link = this.map.page.getByTestId('map-row').getByRole('button', { name: title, exact: true });
  await link.waitFor({ timeout: 10_000 });
  await link.click();
});

// ---- Then ----

Then('the user sees the list led by {string} and {string}, without their row IDs', async function (first, second) {
  const list = this.list;
  const led = await eventually(list.page, async () => (await list.headerCells())[0]?.id, (id) => id && id !== 'col-row_id');
  assert.notEqual(led, 'col-row_id', 'the list is led by the row ID');
  const leading = await eventually(
    list.page,
    () => list.rows().locator('td a').evaluateAll((links) => links.map((a) => (a.textContent ?? '').trim())),
    (texts) => texts.includes(first) && texts.includes(second),
  );
  assert.ok(leading.includes(first) && leading.includes(second), `the rows are led by ${JSON.stringify(leading)}`);
  const rows = await list.rowTexts();
  for (const id of ['cust-1', 'cust-2'])
    assert.ok(!rows.some((text) => text.includes(id)), `a row still shows the row ID ${id}: ${JSON.stringify(rows)}`);
});

Then('the user sees the customer {string} listed by its id', async function (rowId) {
  const list = this.list;
  const headers = await list.headerCells();
  assert.notEqual(headers[0]?.id, 'col-row_id', 'the list is led by the row ID, not the title');
  const leading = await eventually(
    list.page,
    () => list.rows().locator('td a').evaluateAll((links) => links.map((a) => (a.textContent ?? '').trim())),
    (texts) => texts.some((t) => t.includes(rowId)),
  );
  assert.ok(leading.some((t) => t.includes(rowId)), `no row is led by the id ${rowId}: ${JSON.stringify(leading)}`);
  assert.ok(!leading.some((t) => t === ''), `a row is led by a blank: ${JSON.stringify(leading)}`);
});

Then('the user sees the customer of the order {string} as {string}', async function (item, name) {
  const cell = orderRow(this.list, item).locator('[data-testid="cell-customer"]');
  const reads = await eventually(this.list.page, async () => (await cell.textContent()).trim(), (t) => t === name);
  assert.equal(reads, name);
});

Then('the user sees the customer of the order {string} read by its id {string}', async function (item, rowId) {
  const cell = orderRow(this.list, item).locator('[data-testid="cell-customer"]');
  const reads = await eventually(this.list.page, async () => (await cell.textContent()).trim(), (t) => t.includes(rowId));
  assert.ok(reads?.includes(rowId), `the order's customer reads "${reads}"`);
});

Then('the user sees the customer {string}', async function (name) {
  const page = await this.actor();
  await page.waitForURL((url) => url.pathname.includes(`/admin/${encodeURIComponent(CUSTOMERS)}/`), { timeout: 10_000 });
  const field = page.getByTestId('form-view').getByLabel('Customer Name', { exact: true });
  const reads = await eventually(page, () => field.inputValue(), (v) => v === name);
  assert.equal(reads, name);
});

Then('the user sees the filter in use reading {string}', async function (words) {
  const page = await this.actor();
  const chip = page.getByTestId('filter-chip').first();
  const reads = await eventually(page, async () => (await chip.textContent()).replace('×', '').trim(), (t) => t === words);
  assert.equal(reads, words);
});

Then('the user sees a recent filter reading {string}', async function (words) {
  const page = this.list.page;
  const views = page.getByTestId('recent-strip-view');
  const reads = await eventually(page, () => views.allTextContents(), (all) => all.map((t) => t.trim()).includes(words));
  assert.ok(reads?.map((t) => t.trim()).includes(words), `the recent filters read ${JSON.stringify(reads)}`);
});

Then('the user sees {string} listed as assigned to {string}', async function (chore, volunteer) {
  const page = this.map.page;
  const row = page.getByTestId('map-row').filter({ hasText: chore }).first();
  const reads = await eventually(page, () => row.innerText(), (t) => t.includes(volunteer));
  assert.ok(reads?.includes(volunteer), `the listed chore reads "${reads}"`);
  assert.ok(!reads.includes('vol-1'), `the listed chore still shows the id: "${reads}"`);
});

Then('the user sees the map centered on {string}', async function (title) {
  const page = this.map.page;
  const center = page.getByTestId('map-center');
  const reads = await eventually(page, () => center.textContent(), (t) => Boolean(t?.includes(title)));
  assert.ok(reads?.includes(title), `the map's center reads "${reads}"`);
  assert.ok(page.url().includes('/map/Volunteer/'), `the map is at ${page.url()}`);
});
