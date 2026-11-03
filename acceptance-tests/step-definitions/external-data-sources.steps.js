'use strict';

// Steps for connecting an outside database (external-data-sources). The
// outside database is the run's sibling database (support/stack.js); "the
// user" is the seeded System Manager.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { externalSql, EXTERNAL_URL_ENV, EXTERNAL_READER, EXTERNAL_READER_PASSWORD } = require('../support/stack');
const { SourceBrowserPage } = require('../support/pages/source-browser-page');
const { ListPage } = require('../support/pages/list-page');
const { FormPage } = require('../support/pages/form-page');

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
  await grantReader(schema, tables);
  await world.withApi(async (api) => {
    await api.call('DELETE', `/api/table/Data%20Source/${source}`);
    await api.call('POST', '/api/table/Data%20Source', {
      row_id: source, engine: 'postgres', url_env: EXTERNAL_URL_ENV, default_schema: schema, access: 'read_only',
    }, [201], `register the ${source} data source`);
  });
}

async function grantReader(schema, tables) {
  const [exists] = await externalSql('select 1 from pg_roles where rolname = $1', [EXTERNAL_READER]);
  if (!exists) await externalSql(`create role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  else await externalSql(`alter role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  await externalSql(`grant usage on schema ${schema} to ${EXTERNAL_READER}`);
  for (const table of tables) await externalSql(`grant select on ${schema}.${table} to ${EXTERNAL_READER}`);
  const [owned] = await externalSql(
    `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`, [EXTERNAL_READER]);
  assert.equal(owned.n, 0, 'the reader login must own nothing');
}

// ---- Shelves and bins (#783) ----

const SHELVES = 'shelf_fixture';
const SHELF_SOURCE = 'shelves';

Given('a Postgres database of shelves and the bins on each shelf', async function () {
  await externalSql(`drop schema if exists ${SHELVES} cascade`);
  await externalSql(`create schema ${SHELVES}`);
  // The aisle comes before the label, so a shelf read by its first value
  // would read as its aisle (#796); created_on is bookkeeping a list leaves out.
  await externalSql(`create table ${SHELVES}.shelf (
    id bigint primary key, created_on timestamptz not null default now(), aisle text, label text)`);
  await externalSql(`create table ${SHELVES}.bin (code text primary key, shelf_id bigint references ${SHELVES}.shelf(id))`);
  await externalSql(`insert into ${SHELVES}.shelf (id, aisle, label) values (7, 'West', 'Middle')`);
  await externalSql(`insert into ${SHELVES}.bin values ('b1', 7)`);
  this.bin = 'b1';
  await this.withApi(async (api) => {
    // An earlier scenario's app owns its Shelf table: uninstalling removes both.
    await api.call('POST', '/api/uninstall_app', { name: SHELF_APP });
    for (const name of ['Bin', 'Shelf']) await api.removeTableIfPresent(name);
  });
});

// ---- An app that connects the shelves (#808) ----

const SHELF_APP = 'shelf_browser';

// The app brings its own data source over the shelves database; the reader
// login is granted here, as the database's owner would.
function shelfApp(name, settings) {
  return {
    name: SHELF_APP,
    sources: [{
      name: SHELF_SOURCE, engine: 'postgres', url_env: EXTERNAL_URL_ENV, default_schema: SHELVES,
      access: 'read_only', table_allowlist: `${SHELVES}.shelf`,
      reflect: { schema: SHELVES, module: 'Shelves', tables: [{ table: 'shelf', name, ...settings }] },
    }],
  };
}

Given('an app that connects its shelf table as {string}, titled by its {word} and listing only its {word}',
  async function (name, title, listed) {
    await grantReader(SHELVES, ['shelf', 'bin']);
    this.app = shelfApp(name, { title_column: title, list_columns: [listed] });
  });

Given('an app that connects its shelf table as {string}, titled by its {word}, listing only its {word}, and leaving out its {word}',
  async function (name, title, listed, leftOut) {
    await grantReader(SHELVES, ['shelf', 'bin']);
    this.app = shelfApp(name, { title_column: title, list_columns: [listed], leave_out_columns: [leftOut] });
  });

async function installShelfApp(world) {
  return world.withApi(async (api) => {
    await api.call('DELETE', `/api/table/Data%20Source/${SHELF_SOURCE}`);
    const res = await api.call('POST', '/api/install_app', { manifest: world.app });
    return { status: res.status(), body: await res.text() };
  });
}

Given('the app is installed', async function () {
  const { status, body } = await installShelfApp(this);
  assert.equal(status, 201, `the app did not install: ${body}`);
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

Given('a shelf labelled {string} in the {string} aisle', async function (label, aisle) {
  await externalSql(`update ${SHELVES}.shelf set label = $1, aisle = $2 where id = 7`, [label, aisle]);
  this.shelf = '7';
});

Given('only its bin table connected, as {string}', async function (bin) {
  await givenReaderSource(this, SHELF_SOURCE, SHELVES, ['shelf', 'bin']);
  await this.withApi((api) => api.call('POST', `/api/table/Data%20Source/${SHELF_SOURCE}:reflect`, {
    schema: SHELVES, tables: ['bin'], names: { bin },
  }, [200], 'connect the bin table alone'));
});

Given('the user may read bins', async function () {
  const role = await this.withApi((api) => api.readerRoleFor('Bin'));
  await this.person('the user', [role]);
});

Given('a bin on the shelf titled {string}', async function (title) {
  await externalSql(`update ${SHELVES}.shelf set label = $1 where id = 7`, [title]);
});

Given('the user may read bins but not shelves', async function () {
  const role = await this.withApi((api) => api.readerRoleFor('Bin'));
  await this.person('the user', [role]);
});

// ---- When ----

When('the user installs the app', async function () {
  this.installed = await installShelfApp(this);
});

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
  await page.goto(`/featherbase/admin/Bin/${this.bin}`);
  await page.getByTestId('form-view').waitFor();
});

When('the user opens that shelf', async function () {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/Shelf/${this.shelf}`);
  await page.getByTestId('form-view').waitFor();
});

When('the user opens the list of shelves', async function () {
  this.list = new ListPage(await this.actor());
  await this.list.open('Shelf');
});

When('the user opens a bin and takes the offer to connect the shelf table', async function () {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/Bin/${this.bin}`);
  await new FormPage(page).offerToConnect('Shelf').click();
  this.sourceBrowser = new SourceBrowserPage(page);
});

When("the user opens that bin's relationship map", async function () {
  const page = await this.actor();
  await page.goto(`/featherbase/admin/map/Bin/${this.bin}`);
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
  const shown = await list.page.getByTestId('list-view').innerText();
  for (const shop of SHOPS) assert.ok(shown.includes(shop), `${shop} is not listed in ${this.table}`);
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

Then('the user sees the shelf as {string}', async function (title) {
  const form = new FormPage(await this.actor());
  await form.waitForTitle(title).catch(async () => {
    assert.fail(`the shelf reads "${await form.title()}", not "${title}"`);
  });
});

Then("the user sees each shelf's label and aisle", async function () {
  const shown = await this.list.columnLabels();
  for (const label of ['Label', 'Aisle']) assert.ok(shown.includes(label), `the list shows ${shown.join(', ')}, not ${label}`);
});

Then("the user sees each shelf's aisle", async function () {
  const shown = await this.list.columnLabels();
  assert.ok(shown.includes('Aisle'), `the list shows ${shown.join(', ')}, not Aisle`);
});

Then("the user does not see each shelf's label", async function () {
  const shown = await this.list.columnLabels();
  assert.ok(!shown.includes('Label'), `the list shows ${shown.join(', ')}`);
});

Then('the app is not installed', async function () {
  assert.notEqual(this.installed.status, 201, 'the app installed');
  const apps = await this.withApi(async (api) => (await api.call('GET', '/api/apps', undefined, [200], 'list apps')).json());
  const listed = apps.installed.map((a) => a.name);
  assert.ok(!listed.includes(SHELF_APP), 'the app is listed as installed');
});

Then('the user is told the shelf table has no column {string}', async function (column) {
  assert.match(this.installed.body, new RegExp(`shelf[^"]*${column}|${column}[^"]*shelf`, 'i'),
    `the refusal says: ${this.installed.body}`);
});

Then('no table called {string} is in Featherbase', async function (name) {
  const status = await this.withApi(async (api) => (await api.call('GET', `/api/table/${encodeURIComponent(name)}:meta`)).status());
  assert.equal(status, 404, `a table called ${name} exists`);
});

Then('the user does not see when each shelf was created', async function () {
  const shown = await this.list.columnLabels();
  assert.ok(!shown.some((l) => /created/i.test(l)), `the list shows ${shown.join(', ')}`);
});

Then("the user sees that its shelf's table is not connected yet", async function () {
  const note = await new FormPage(await this.actor()).noteBeside('Shelf');
  assert.match(note, /not connected yet/i, `beside the shelf the form says "${note}"`);
});

Then('the user is offered to connect the shelf table', async function () {
  await new FormPage(await this.actor()).offerToConnect('Shelf').waitFor();
});

Then('the user is not offered to connect it', async function () {
  assert.equal(await new FormPage(await this.actor()).offerToConnect('Shelf').count(), 0, 'the user is offered to connect it');
});

Then('the user sees the shelf table chosen, ready to connect', async function () {
  const choice = this.sourceBrowser.choice(SHELVES, 'shelf');
  await choice.waitFor();
  await this.sourceBrowser.page.waitForFunction(
    (el) => el.checked, await choice.elementHandle(), { timeout: 10_000 },
  ).catch(() => assert.fail('the shelf table is not chosen'));
});

Then('the user does not see {string}', async function (text) {
  const page = await this.actor();
  await page.waitForLoadState('networkidle');
  assert.ok(!(await page.locator('main').innerText()).includes(text), `"${text}" is shown`);
});
