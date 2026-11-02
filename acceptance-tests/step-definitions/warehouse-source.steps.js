'use strict';

// Steps for connecting a MotherDuck warehouse by its token and browsing it
// (external-data-sources, #772). The warehouse is the local stand-in the stack
// builds (support/stack.js); its made-up tokens are below. "The user" is the
// seeded System Manager unless a step says otherwise.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Given, When, Then } = require('@cucumber/cucumber');
const { addStandinTable } = require('../support/stack');
const { ConnectWarehousePage, WarehouseSourcePage, DataSourcesSidebar, WarehouseBrowserPage } = require('../support/pages/warehouse-pages');

// The stand-in's tokens (apps/server/test/motherduck-standin.ts).
const TOKENS = {
  reader: 'standin-read-scaling-token-4f2a',
  writer: 'standin-read-write-token-77b1',
  second: 'standin-second-read-token-9c1e',
  refused: 'standin-revoked-token-0000',
};
const byLastFour = (four) => Object.values(TOKENS).find((t) => t.endsWith(four));

/** A MotherDuck source saved through the API, with a name of this scenario's own. */
async function givenSource(world, databases, token = TOKENS.reader) {
  world.source = `acc-wh-${randomUUID().slice(0, 8)}`;
  await world.withApi((api) =>
    api.call('POST', '/api/table/Data%20Source:motherduck_connect', { name: world.source, token, databases }, [201], `connect ${world.source}`),
  );
}

// ---- Given ----

Given('the user is a System Manager', async function () {
  this.page = await this.asSystemManager();
});

Given('a token that can read five databases, among them {string} and {string}', async function (first, second) {
  this.token = TOKENS.reader;
  this.expected = [first, second];
  this.connect = new ConnectWarehousePage(await this.asSystemManager());
  await this.connect.open();
});

Given('a token that has passed its test', async function () {
  this.connect = new ConnectWarehousePage(await this.asSystemManager());
  await this.connect.open();
  await this.connect.test(TOKENS.reader);
});

Given('a MotherDuck source saved with a token ending in {string}', async function (four) {
  this.token = byLastFour(four);
  await givenSource(this, ['sales', 'stock'], this.token);
});

Given('a MotherDuck source reading the databases {string} and {string}', async function (first, second) {
  await givenSource(this, [first, second]);
});

Given('the user last browsed the schema {string} of the database {string}', async function (schema, database) {
  await givenSource(this, ['sales', 'stock']);
  const browser = new WarehouseBrowserPage(await this.asSystemManager());
  await browser.open(this.source);
  await browser.pickDatabase(database);
  await browser.pickSchema(schema);
});

Given('the table list of {string} was read before the table {string} was added', async function (database, table) {
  await givenSource(this, ['sales', 'stock']);
  this.browser = new WarehouseBrowserPage(await this.asSystemManager());
  await this.browser.open(this.source);
  await this.browser.pickDatabase(database);
  await this.browser.tables();
  addStandinTable(database, table);
});

// ---- When ----

When('the user tests a working token that can read five databases', async function () {
  this.connect = new ConnectWarehousePage(this.page);
  await this.connect.open();
  await this.connect.test(TOKENS.reader);
});

When('the user tests a token that MotherDuck refuses', async function () {
  this.connect = new ConnectWarehousePage(this.page);
  await this.connect.open();
  await this.connect.test(TOKENS.refused);
});

When('the user tests a working token that can also write to the warehouse', async function () {
  this.connect = new ConnectWarehousePage(this.page);
  await this.connect.open();
  await this.connect.test(TOKENS.writer);
});

When('the user ticks {string} and {string} and saves the source', async function (first, second) {
  this.source = `acc-wh-${randomUUID().slice(0, 8)}`;
  await this.connect.name(this.source);
  await this.connect.test(this.token);
  await this.connect.tick(first);
  await this.connect.tick(second);
  await this.connect.save();
});

When('the user has ticked no database', function () {
  // Nothing is ticked after a test; the scenario checks the save is blocked.
});

When('the user opens the source', async function () {
  this.sourcePage = new WarehouseSourcePage(await this.asSystemManager());
  await this.sourcePage.open(this.source);
});

When('the user replaces it with a working token ending in {string}', async function (four) {
  this.sourcePage = new WarehouseSourcePage(await this.asSystemManager());
  await this.sourcePage.open(this.source);
  await this.sourcePage.replaceToken(byLastFour(four));
});

When('the user looks at the sidebar', async function () {
  this.sidebar = new DataSourcesSidebar(await this.asSystemManager());
  await this.sidebar.openAdmin();
});

When('the user opens {string}, picks the schema {string} and the table {string}', async function (database, schema, table) {
  const page = await this.asSystemManager();
  await new DataSourcesSidebar(page).openAdmin();
  await new DataSourcesSidebar(page).openDatabase(this.source, database);
  this.browser = new WarehouseBrowserPage(page);
  await this.browser.pickSchema(schema);
  await this.browser.pickTable(table);
});

When('a user who is not a System Manager looks for it', async function () {
  const role = await this.withApi((api) => api.readerRoleFor('Import Log'));
  await this.person('a clerk', [role]);
  const page = await this.signedIn('a clerk');
  this.sidebar = new DataSourcesSidebar(page);
  await this.sidebar.openAdmin();
  this.clerkBrowser = new WarehouseBrowserPage(page);
});

When('the user opens the source again', async function () {
  this.browser = new WarehouseBrowserPage(await this.asSystemManager());
  await this.browser.open(this.source);
});

When('the user refreshes the table list of {string}', async function (database) {
  assert.equal((await this.browser.place()).database, database);
  await this.browser.refresh();
});

// ---- Then ----

Then('they are told who the token signs in as and that it can read five databases', async function () {
  assert.match(await this.connect.result(), /Connected as reader_user · it can read 5 databases/);
});

Then('they are told the token was refused, in plain words', async function () {
  assert.match(await this.connect.result(), /MotherDuck refused the token/);
});

Then('the message does not contain the token', async function () {
  assert.ok(!(await this.connect.result()).includes(TOKENS.refused));
});

Then('the test succeeds, with a warning to use a read scaling token instead', async function () {
  const result = await this.connect.result();
  assert.match(result, /Connected as writer_user/);
  assert.match(result, /read scaling token instead/);
});

Then('browsing the source offers {string} and {string} and no other database', async function (first, second) {
  const offered = await new WarehouseBrowserPage(await this.asSystemManager()).databasesOffered();
  assert.deepEqual(offered, [first, second]);
});

Then('the source cannot be saved', async function () {
  assert.equal(await this.connect.canSave(), false);
});

Then('they see that a token is saved, ending in {string}', async function (four) {
  assert.match(await this.sourcePage.token(), new RegExp(`Saved, ending …${four}`));
});

Then('the rest of the token appears nowhere on the page', async function () {
  assert.ok(!(await this.sourcePage.pageText()).includes(this.token));
});

Then('the source shows a token ending in {string}', async function (four) {
  assert.match(await this.sourcePage.tokenEnding(four), new RegExp(`Saved, ending …${four}`));
});

Then('it shows the source with {string} and {string} under it', async function (first, second) {
  assert.deepEqual(await this.sidebar.databasesUnder(this.source), [first, second]);
});

Then('they see how many rows and columns {string} has, its first rows and its column names', async function (table) {
  assert.match(await this.browser.previewTitle(), new RegExp(`^${table}$`));
  const preview = await this.browser.preview();
  assert.match(preview.size, /3 rows · 4 columns/);
  assert.match(preview.rows, /Harbour Road/);
  for (const column of ['code', 'name', 'city', 'state_code']) assert.match(preview.columns, new RegExp(column));
});

Then("the sidebar lists no data source, and opening the source's browser is refused", async function () {
  assert.equal(await this.sidebar.shown(), false);
  await this.clerkBrowser.open(this.source);
  assert.equal(await this.clerkBrowser.refused(), true);
});

Then('the browser opens on the schema {string} of {string}', async function (schema, database) {
  assert.deepEqual(await this.browser.place(), { database, schema });
});

Then('{string} is listed', async function (table) {
  assert.ok((await this.browser.tables()).includes(table), `${table} is not listed`);
});
