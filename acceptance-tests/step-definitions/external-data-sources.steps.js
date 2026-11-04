'use strict';

// Steps for connecting an outside database (external-data-sources). The
// outside database is the run's sibling database (support/stack.js); "the
// user" is the seeded System Manager.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('playwright/test');
const { externalSql, EXTERNAL_URL_ENV, EXTERNAL_READER, EXTERNAL_READER_PASSWORD } = require('../support/stack');
const { SourceBrowserPage } = require('../support/pages/source-browser-page');
const { ListPage } = require('../support/pages/list-page');

const SCHEMA = 'shop_fixture';
const SOURCE = 'shops';
const SHOPS = ['North', 'South'];

// ---- Given ----

Given('the user is a System Manager', async function () {
  await this.asSystemManager();
});

Given('a Postgres database with a shop table whose rows are identified by their id', async function () {
  await externalSql(`drop schema if exists ${SCHEMA} cascade`);
  await externalSql(`create schema ${SCHEMA}`);
  await externalSql(`create table ${SCHEMA}.shop (id bigint primary key, name text)`);
  await externalSql(`insert into ${SCHEMA}.shop values (1, $1), (2, $2)`, SHOPS);
});

Given('a data source whose login may only read that table and owns nothing', async function () {
  await givenReaderSource(this, SOURCE, SCHEMA, ['shop']);
});

// One reader login on the outside database: it may read these tables and
// owns nothing. A role is shared by the whole cluster, so it is made again.
async function givenReaderSource(world, source, schema, tables) {
  const [exists] = await externalSql('select 1 from pg_roles where rolname = $1', [EXTERNAL_READER]);
  if (!exists) await externalSql(`create role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  else await externalSql(`alter role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  await externalSql(`grant usage on schema ${schema} to ${EXTERNAL_READER}`);
  for (const table of tables) await externalSql(`grant select on ${schema}.${table} to ${EXTERNAL_READER}`);
  const [owned] = await externalSql(
    `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`, [EXTERNAL_READER]);
  assert.equal(owned.n, 0, 'the reader login must own nothing');
  await world.withApi(async (api) => {
    await api.call('DELETE', `/api/table/Data%20Source/${source}`);
    await api.call('POST', '/api/table/Data%20Source', {
      row_id: source, engine: 'postgres', url_env: EXTERNAL_URL_ENV, default_schema: schema, access: 'read_only',
    }, [201], `register the ${source} data source`);
  });
}

// ---- Shelves and bins (#783) ----

const SHELVES = 'shelf_fixture';
const SHELF_SOURCE = 'shelves';

Given('a Postgres database of shelves and the bins on each shelf', async function () {
  await externalSql(`drop schema if exists ${SHELVES} cascade`);
  await externalSql(`create schema ${SHELVES}`);
  await externalSql(`create table ${SHELVES}.shelf (id bigint primary key, label text)`);
  await externalSql(`create table ${SHELVES}.bin (code text primary key, shelf_id bigint references ${SHELVES}.shelf(id))`);
  await externalSql(`insert into ${SHELVES}.shelf values (7, 'Middle')`);
  await externalSql(`insert into ${SHELVES}.bin values ('b1', 7)`);
  this.bin = 'b1';
  for (const name of ['Bin', 'Shelf']) await this.withApi((api) => api.removeTableIfPresent(name));
});

Given('a data source for that database', async function () {
  await givenReaderSource(this, SHELF_SOURCE, SHELVES, ['shelf', 'bin']);
});

Given('its shelf and bin tables connected as {string} and {string}', async function (shelf, bin) {
  await givenReaderSource(this, SHELF_SOURCE, SHELVES, ['shelf', 'bin']);
  await this.withApi((api) => api.call('POST', `/api/table/Data%20Source/${SHELF_SOURCE}:reflect`, {
    schema: SHELVES, tables: ['shelf', 'bin'], names: { shelf, bin },
  }, [200], 'connect the shelf and bin tables'));
});

Given('a bin on the shelf titled {string}', async function (title) {
  await externalSql(`update ${SHELVES}.shelf set label = $1 where id = 7`, [title]);
});

Given('the user may read bins but not shelves', async function () {
  const role = await this.withApi((api) => api.readerRoleFor('Bin'));
  await this.person('the user', [role]);
});

// ---- When ----

When('the user browses the data source', async function () {
  this.sourceBrowser = new SourceBrowserPage(await this.actor());
  await this.sourceBrowser.open(SOURCE, SCHEMA);
  await this.sourceBrowser.row('shop').waitFor();
});

When('the user connects it', async function () {
  this.table = await this.sourceBrowser.connect(SCHEMA, 'shop');
});

When('the user connects its shelf and bin tables, naming them {string} and {string}', async function (shelf, bin) {
  const browser = new SourceBrowserPage(await this.actor());
  await browser.open(SHELF_SOURCE, SHELVES);
  await browser.row('bin').waitFor();
  await browser.connectNamed(SHELVES, { shelf, bin });
});

When('the user opens a bin', async function () {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/table/bin/row/${this.bin}`);
  await page.getByTestId('form-view').waitFor();
});

When("the user opens that bin's relationship map", async function () {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/table/bin/row/${this.bin}/map`);
  await page.getByTestId('map-forward-Shelf').waitFor();
});

// ---- Then ----

Then('the shop table is offered for connecting', async function () {
  const choice = this.sourceBrowser.choice(SCHEMA, 'shop');
  if (await choice.isDisabled())
    assert.fail(`the shop table is not offered for connecting: "${await this.sourceBrowser.refusal('shop')}"`);
});

Then("the user sees the database's shops listed in Featherbase", async function () {
  const list = new ListPage(await this.actor());
  await list.open(this.table);
  for (const shop of SHOPS)
    await expect(list.rows().filter({ hasText: shop }), `${shop} is not listed in ${this.table}`).toBeVisible();
});

Then('the user sees tables called {string} and {string} in Featherbase', async function (first, second) {
  const list = new ListPage(await this.actor());
  for (const name of [first, second]) await list.open(name);
});

Then('the user sees its link to a shelf labelled {string}', async function (label) {
  const page = await this.actor();
  await page.getByLabel(label, { exact: true }).waitFor();
});

Then('the user sees its shelf as {string}', async function (title) {
  const box = (await this.actor()).getByTestId('map-forward-Shelf');
  await box.getByText(title, { exact: true }).waitFor({ timeout: 10_000 }).catch(async () => {
    assert.fail(`the shelf box reads "${(await box.textContent()).trim()}", not "${title}"`);
  });
});

Then('the user does not see {string}', async function (text) {
  const page = await this.actor();
  await page.waitForLoadState('networkidle');
  assert.ok(!(await page.locator('main').innerText()).includes(text), `"${text}" is shown`);
});
