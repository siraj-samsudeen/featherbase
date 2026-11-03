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
  // A role is shared by the whole cluster: make it again, owning nothing.
  const [exists] = await externalSql('select 1 from pg_roles where rolname = $1', [EXTERNAL_READER]);
  if (!exists) await externalSql(`create role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  else await externalSql(`alter role ${EXTERNAL_READER} login password '${EXTERNAL_READER_PASSWORD}'`);
  await externalSql(`grant usage on schema ${SCHEMA} to ${EXTERNAL_READER}`);
  await externalSql(`grant select on ${SCHEMA}.shop to ${EXTERNAL_READER}`);
  const [owned] = await externalSql(
    `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`, [EXTERNAL_READER]);
  assert.equal(owned.n, 0, 'the reader login must own nothing');

  await this.withApi(async (api) => {
    await api.call('DELETE', `/api/table/Data%20Source/${SOURCE}`);
    await api.call('POST', '/api/table/Data%20Source', {
      row_id: SOURCE, engine: 'postgres', url_env: EXTERNAL_URL_ENV, default_schema: SCHEMA, access: 'read_only',
    }, [201], 'register the shops data source');
  });
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
