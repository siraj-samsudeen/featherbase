'use strict';

const assert = require('node:assert/strict');
const { default: postgres } = require('postgres');
const { AfterAll } = require('@cucumber/cucumber');
const { isolatedEnvironment, restartAcceptance } = require('../stack');

const STORE = 'Explore Source Store';
const FLOOR = 'Explore Source Floor';
let sourceUrl;

class SourceExplorePage {
  constructor(page) { this.page = page; }

  static async install(api) {
    const url = new URL(isolatedEnvironment().DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'synthetic source requires local Postgres');
    url.pathname = '/postgres';
    const maintenance = postgres(url.toString(), { max: 1 });
    try {
      const exists = await maintenance`select 1 from pg_database where datname = 'featherbase_issue786_acceptance_source'`;
      if (!exists.length) await maintenance.unsafe('create database featherbase_issue786_acceptance_source');
    } finally { await maintenance.end(); }
    url.pathname = '/featherbase_issue786_acceptance_source';
    sourceUrl = url.toString();
    const db = postgres(sourceUrl, { max: 1, onnotice() {} });
    try {
      await db.unsafe(`create schema if not exists issue786;
        create table if not exists issue786.store (code int primary key, label text);
        create table if not exists issue786.floor (code int primary key, label text, store_id int);
        truncate issue786.floor, issue786.store;
        insert into issue786.store values (11,'North'),(29,'South'),(47,'Empty');
        insert into issue786.floor values (101,'North one',11),(103,'North two',11),
          (211,'South only',29),(307,'Unlinked',null),(401,'Orphan',9999);`);
    } finally { await db.end(); }
    await restartAcceptance({ ISSUE786_ACCEPTANCE_SOURCE_URL: sourceUrl });
    const exists = await api.call('GET', `/api/table/${encodeURIComponent(STORE)}:meta`, undefined, [200, 404]);
    if (exists.status() === 200) return;
    await api.call('POST', '/api/table/Data%20Source', {
      row_id: 'issue786-acceptance', engine: 'postgres', access: 'read_only', url_env: 'ISSUE786_ACCEPTANCE_SOURCE_URL',
    }, [201]);
    for (const [name, relation, columns] of [
      [STORE, 'store', [{ column_name: 'label', column_type: 'Data' }]],
      [FLOOR, 'floor', [{ column_name: 'label', column_type: 'Data' },
        { column_name: 'store', column_type: 'Reference', reference_table: STORE, source_column: 'store_id' }]],
    ]) await api.call('POST', '/api/table_def', {
      name, title_column: 'label', data_source: 'issue786-acceptance', external_schema: 'issue786',
      external_table: relation, external_pk: 'code', columns,
    }, [200, 201]);
  }

  async open(selected) {
    await this.page.goto('/featherbase/admin/explore');
    await this.page.getByTestId('explore-root').selectOption(STORE);
    await this.page.getByTestId('explore-step2').selectOption(`backlink:${FLOOR}:store`);
    if (selected) await this.page.getByRole('button', { name: selected, exact: true }).click();
  }

  async expectFloors(labels, count) {
    const pane = this.page.getByTestId('explore-pane2');
    // A failure must not look like an empty result.
    await pane.getByTestId('explore-pane2-count').filter({ hasText: new RegExp(`^${count}$`) }).waitFor();
    const names = await Promise.all((await pane.getByTestId('explore-row').all()).map(row => row.locator('span').first().textContent()));
    assert.deepEqual(names.sort(), labels.slice().sort());
    assert.equal(await pane.getByText(/Cannot load/).count(), 0);
  }

  async filtered(api, label) {
    const filters = [['store', 'related', { table: STORE, filters: [['label', '=', label]] }]];
    const response = await api.call('GET', `/api/table/${encodeURIComponent(FLOOR)}?${new URLSearchParams({ filters: JSON.stringify(filters) })}`, undefined, [200]);
    this.result = await response.json();
  }

  async large(api) {
    const db = postgres(sourceUrl, { max: 1 });
    try {
      await db.unsafe(`insert into issue786.store select n, 'Bulk ' || n from generate_series(1000,1600) n;
        insert into issue786.floor values (601,'Last store',1600);`);
    } finally { await db.end(); }
    const filters = [['store', 'related', { table: STORE, filters: [] }]];
    const response = await api.call('GET', `/api/table/${encodeURIComponent(FLOOR)}?${new URLSearchParams({ fields: '["row_id"]', filters: JSON.stringify(filters), order_by: 'row_id asc' })}`, undefined, [200]);
    this.result = await response.json();
  }

  expectEmpty() { assert.deepEqual(this.result.data, []); assert.equal(this.result.total, 0); }
  expectLarge() { assert.deepEqual(this.result.data, [{ row_id: '101' }, { row_id: '103' }, { row_id: '211' }, { row_id: '601' }]); assert.equal(this.result.total, 4); }
}

AfterAll(async function () {
  if (!sourceUrl) return;
  const db = postgres(sourceUrl, { max: 1, onnotice() {} });
  try { await db.unsafe('drop schema issue786 cascade'); } finally { await db.end(); }
});

module.exports = { SourceExplorePage };
