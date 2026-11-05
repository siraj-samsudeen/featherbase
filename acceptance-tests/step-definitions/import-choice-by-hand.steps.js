'use strict';

// Steps for a Choice picked by hand, refusals that say why, and trying again
// after a dropped connection (spreadsheet-import). Made-up data.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { ImportWizardPage } = require('../support/pages/import-wizard-page');

const TABLE = 'Choice By Hand';
const csv = (rows) => rows.map((r) => r.join(',')).join('\n');

async function dropped(world) {
  await world.removeTableIfPresent(TABLE);
  const wizard = new ImportWizardPage(await world.asSystemManager());
  await wizard.open();
  await wizard.dropCsv('sheet.csv', csv(world.importRows));
  await wizard.asNewTable(TABLE);
  world.wizard = wizard;
  return wizard;
}

const count = (world) => world.withApi(async (api) => (await api.rowIds(TABLE, 100)).length);

Given('a sheet whose Section column holds {int} different values', function (n) {
  this.importRows = [['Section', 'Code'], ...Array.from({ length: n * 3 }, (_, i) => [`Section ${String(i % n).padStart(2, '0')}`, `c${i}`])];
});
Given('a sheet whose Zone column repeats Dairy and Fresh with spaces around them', function () {
  this.importRows = [['Zone', 'Code'], ...Array.from({ length: 12 }, (_, i) => [i % 2 ? '" Fresh"' : '"Dairy "', `c${i}`])];
});
Given('a sheet with a Zone column', function () {
  this.importRows = [['Zone', 'Code'], ['North', 'x'], ['South', 'y']];
});
Given('a sheet whose Zone column holds only words', function () {
  this.importRows = [['Zone', 'Code'], ['North', 'x'], ['South', 'y']];
});

When('the user imports it as a new table with Section switched to Choice', async function () {
  const wizard = await dropped(this);
  await wizard.setType('Section', 'Choice');
  await wizard.importAll();
});
When('the user switches Section to Choice in the import wizard', async function () {
  const wizard = await dropped(this);
  await wizard.setType('Section', 'Choice');
});
When('the user imports it as a new table', async function () {
  const wizard = await dropped(this);
  if (this.dropConnection) {
    await this.dropConnection(wizard.page);
    this.failure = await wizard.importExpectingFailure();
  } else {
    await wizard.importAll();
  }
});
When('the user imports it as a new table with Zone\'s column name changed to {string}', async function (name) {
  const wizard = await dropped(this);
  await wizard.setColumnName('Zone', name);
  this.failure = await wizard.importExpectingFailure();
});
When('the user imports it as a new table with Zone switched to Int', async function () {
  const wizard = await dropped(this);
  await wizard.setType('Zone', 'Int');
  await wizard.page.getByTestId('iw-import').click();
});

Given('the connection drops while the import is sending its rows', function () {
  this.dropConnection = (page) => page.route('**/*:import', (route) => route.fulfill({ status: 502, body: 'bad gateway' }));
});
Given('the connection drops after one row has landed', function () {
  this.dropConnection = (page) => page.route('**/*:import', async (route) => {
    await this.withApi((api) => api.saveRow(TABLE, { zone: 'North', code: 'x' }));
    await route.fulfill({ status: 502, body: 'bad gateway' });
  });
});
When('the connection is back and the user imports again', async function () {
  const { page } = this.wizard;
  await page.unroute('**/*:import');
  await page.getByTestId('iw-import').click();
});

Then('the new table holds every row', async function () {
  const expected = this.importRows.length - 1;
  for (let i = 0; i < 40 && (await count(this)) !== expected; i++) await new Promise((r) => setTimeout(r, 250));
  assert.equal(await count(this), expected);
});
Then('the new table holds {int} row', async function (n) {
  assert.equal(await count(this), n);
});
Then('its Section column offers all {int} values', async function (n) {
  const meta = await this.withApi(async (api) => (await api.call('GET', `/api/table/${encodeURIComponent(TABLE)}:meta`, undefined, [200], `read ${TABLE}`)).json());
  assert.equal(meta.columns.find((c) => c.column_name === 'section').choices.split('\n').length, n);
});
Then('the wizard shows the first {int} options and says {int} more', async function (shown, more) {
  const text = await this.wizard.optionsShown('Section');
  assert.equal(text.split(', ').length, shown);
  assert.match(text, new RegExp(`\\+${more} more$`));
});
Then('the import says the table failed because Column {string} must be snake_case', function (column) {
  assert.match(this.failure, new RegExp(`failed — Invalid Table definition — Column .${column}.: column_name must be snake_case`));
});
Then('the wizard stays open and reports the rows as failed', async function () {
  assert.match(await this.wizard.resultText(), /2 failed/);
  assert.ok(await this.wizard.page.getByTestId('import-wizard').isVisible());
});
Then('the import says the table failed', function () {
  assert.match(this.failure, /failed — Request failed \(502\)/);
});
Then('the import says the table already holds {int} row and to undo it under Past imports', async function (n) {
  const text = await this.wizard.failureAfter(this.failure);
  assert.match(text, new RegExp(`already holds ${n} row from the attempt that stopped\\. Undo it under Past imports`));
});
