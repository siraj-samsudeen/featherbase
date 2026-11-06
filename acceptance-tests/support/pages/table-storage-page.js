'use strict';

const assert = require('node:assert/strict');
const { rowHref } = require('../../../packages/shared/src/app-routes.ts');
const { acceptanceSql, restartAcceptance } = require('../stack');

class TableStoragePage {
  constructor(page, api) { this.page = page; this.api = api; this.table = 'SAP Plant'; }

  async define(kind = 'table') {
    await this.api.createTable({ name: this.table, module: 'Custom', kind,
      columns: [{ column_name: 'plant_name', column_type: 'Data' }] });
  }

  async authorTitle() {
    await this.api.call('PUT', `/api/table_def/${encodeURIComponent(this.table)}`,
      { name: this.table, module: 'Custom', description: 'Plant catalogue', columns: [{ column_name: 'plant_name', column_type: 'Data' }] }, [200]);
    await this.api.call('POST', '/api/table/Metadata%20Override', { row_id: 'storage-860-title', table_name: 'Table', property: 'title_column', value: 'description' }, [201]);
    this.authored = true;
  }

  async connect() {
    await this.define();
    await acceptanceSql("insert into featherbase.data_source (row_id, engine, url_env) values ('storage-860-source', 'postgres', 'UNSET_STORAGE_860_URL') on conflict do nothing");
    await acceptanceSql("update featherbase.table_def set data_source = 'storage-860-source', external_schema = 'erp', external_table = 'plants_actual', external_pk = 'plant_code' where name = 'SAP Plant'");
    await restartAcceptance();
  }

  async install() {
    const response = await this.api.call('GET', '/api/apps', undefined, [200], 'installed apps');
    const { installed } = await response.json();
    if (!installed.some(app => app.name === 'tasker'))
      await this.api.call('POST', '/api/apps/prepare-install', { name: 'tasker' }, [201]);
    await this.api.admitTaskerAdministrator();
    this.table = 'tasker.task';
    await acceptanceSql("update featherbase.table_def set label = 'SAP Plant' where name = 'tasker.task'");
    await restartAcceptance();
  }

  async open() {
    await this.page.goto(rowHref('Table', this.table));
    await this.page.getByTestId('form-view').waitFor();
  }

  async title(expected) {
    await this.page.getByRole('heading', { name: `Table: ${expected}`, exact: true }).waitFor();
    assert.match(await this.page.getByTestId('breadcrumbs').innerText(), new RegExp(expected));
  }

  async copy(expected) {
    const storage = this.page.getByTestId('table-storage');
    await storage.waitFor();
    for (const value of expected) assert.ok((await storage.innerText()).includes(value), `missing ${value}`);
    assert.equal(await storage.locator('input:not([readonly]), textarea:not([readonly]), select').count(), 0);
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const button = storage.getByRole('button', { name: 'Copy storage', exact: true });
    await button.focus();
    await this.page.keyboard.press('Enter');
    await storage.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
    const copied = await this.page.evaluate(() => navigator.clipboard.readText());
    for (const value of expected) assert.ok(copied.includes(value), `clipboard missing ${value}`);
    assert.equal(await this.page.getByTestId('form-status').innerText(), 'Saved');
  }

  async absentWarehouse() {
    const storage = this.page.getByTestId('table-storage');
    await storage.waitFor();
    assert.doesNotMatch(await storage.innerText(), /warehouse|bronze_featherbase/i);
  }

  async denied() {
    await this.page.getByRole('heading', { name: 'Table: SAP Plant', exact: true }).waitFor();
    assert.equal(await this.page.getByTestId('table-storage').count(), 0);
    // The definition reads Module: Custom — in its text box to whoever may edit it, or as its
    // value, read only, to a reader (#795).
    const input = this.page.locator('[data-field="module"]');
    const value = this.page.locator('[data-form-field="module"] [data-value]');
    await input.or(value).first().waitFor();
    assert.equal(await input.count() ? await input.inputValue() : (await value.innerText()).trim(), 'Custom');
  }

  async cleanup() {
    if (this.authored) {
      await acceptanceSql("delete from featherbase.metadata_override where table_name = 'Table' and property = 'title_column'");
      await restartAcceptance();
    }
    if (this.table === 'SAP Plant') {
      await acceptanceSql("update featherbase.table_def set data_source = null, external_schema = null, external_table = null, external_pk = null where name = 'SAP Plant'");
      await restartAcceptance();
      await this.api.removeTableIfPresent(this.table);
    }
  }
}

module.exports = { TableStoragePage };
