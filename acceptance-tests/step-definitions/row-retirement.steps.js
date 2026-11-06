'use strict';

// Steps for retiring a row (row-retirement, #859). The plants and a
// retirement a scenario starts from are made through the API; retiring,
// reactivating and what the list shows go through the browser.

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { ListPage } = require('../support/pages/list-page');
const { RetirementPage } = require('../support/pages/row-retirement');

const PLANTS = 'Retirement Plant';

After(async function () {
  if (this.plants) await this.withApi((api) => api.removeTableIfPresent(PLANTS));
});

Given('a table of plants holds {string} and {string}', async function (first, second) {
  this.plants = PLANTS;
  await this.withApi((api) => api.createTable(
    { name: PLANTS, module: 'Custom', id_pattern: 'prompt', columns: [{ column_name: 'city', label: 'City', column_type: 'Data', in_list_view: true }] },
    [{ row_id: first, city: 'Kochi' }, { row_id: second, city: 'Nowhere' }],
  ));
});

Given('{string} is retired because {string}', async function (plant, reason) {
  await this.withApi((api) => api.call(
    'POST', `/api/table/${encodeURIComponent(PLANTS)}/${encodeURIComponent(plant)}:retire`, { reason }, [200], `retire ${plant}`,
  ));
});

When('the user retires {string} because {string}', async function (plant, reason) {
  const form = new RetirementPage(await this.asSystemManager());
  await form.open(PLANTS, plant);
  await form.retire(reason);
});

Then('{string} shows it is retired because {string}', async function (plant, reason) {
  const form = new RetirementPage(await this.asSystemManager());
  await form.open(PLANTS, plant);
  assert.equal(await form.retiredReason(), reason);
});

When('the user reactivates {string}', async function (plant) {
  const form = new RetirementPage(await this.asSystemManager());
  await form.open(PLANTS, plant);
  await form.reactivate();
});

When('the user opens the list of plants', async function () {
  this.list = new ListPage(await this.asSystemManager());
  await this.list.open(PLANTS);
});

When('the user opens the list of plants and asks to see retired rows', async function () {
  const page = await this.asSystemManager();
  this.list = new ListPage(page);
  await this.list.open(PLANTS);
  await new RetirementPage(page).showRetired();
});

async function shownPlants(world, expectedCount) {
  // Rows arrive after the headers; give them a few seconds to settle.
  let shown = [];
  for (const start = Date.now(); Date.now() - start < 5_000; await new Promise((r) => setTimeout(r, 200))) {
    shown = await new RetirementPage(world.list.page).rowTitles();
    if (shown.length === expectedCount) break;
  }
  return shown;
}

Then('the list shows {string} and not {string}', async function (kept, left) {
  const shown = await shownPlants(this, 1);
  assert.deepEqual(shown, [kept]);
  assert.ok(!shown.includes(left));
});

Then('the list shows {string} and {string}', async function (first, second) {
  assert.deepEqual((await shownPlants(this, 2)).sort(), [first, second].sort());
});

Then('only {string} is marked as retired', async function (plant) {
  assert.deepEqual(await new RetirementPage(this.list.page).retiredRowTitles(), [plant]);
});

Then('the list of plants shows {string} and {string}', async function (first, second) {
  this.list = new ListPage(await this.asSystemManager());
  await this.list.open(PLANTS);
  assert.deepEqual((await shownPlants(this, 2)).sort(), [first, second].sort());
});
