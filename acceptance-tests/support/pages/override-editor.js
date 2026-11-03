'use strict';

const { randomUUID } = require('node:crypto');
const { expect } = require('playwright/test');

class OverrideEditor {
  constructor(page, api) { this.page = page; this.api = api; this.table = `Editor Shelf ${randomUUID().slice(0, 8)}`; }

  async prepare() {
    await this.api.createTable({ name: this.table, columns: [{ column_name: 'floor', column_type: 'Data', in_list_view: true }] });
    await this.api.saveRow('Custom Field', { row_id: `${this.table}-note`, dt: this.table, column_name: 'note', column_type: 'Data', label: 'Note' });
    const prefill = encodeURIComponent(JSON.stringify({ table_name: this.table }));
    await this.page.goto(`/featherbase/admin/Metadata%20Override/new?prefill=${prefill}`);
    this.form = this.page.getByTestId('form-view');
    await expect(this.form.getByLabel('Column', { exact: true })).toBeEnabled();
  }

  async chooseHidden(column) {
    await expect(this.form.getByLabel('Column', { exact: true }).locator('option')).toContainText(['', 'Whole Table', 'floor', 'note']);
    await this.form.getByLabel('Column', { exact: true }).selectOption(column);
    await this.form.getByLabel('Setting', { exact: true }).selectOption('Hidden (hidden)');
    await this.form.getByLabel('Value', { exact: true }).check();
  }

  async saveHidden(column) {
    await this.chooseHidden(column);
    await expect(this.form.locator('[data-field="row_id"]')).toHaveCount(0);
    await this.form.getByTestId('form-save').click();
    await expect(this.form.getByRole('link', { name: `Open Table: ${this.table}`, exact: true })).toBeVisible();
    this.id = decodeURIComponent(new URL(this.page.url()).pathname.split('/').pop());
  }

  async saved() { return this.api.row('Metadata Override', this.id); }
  async title(column, setting) { await expect(this.form.getByRole('heading', { level: 1 })).toContainText(`${this.table} · ${column} · ${setting}`); }
  async openTarget() {
    await this.form.getByRole('link', { name: `Open Table: ${this.table}`, exact: true }).click();
    await expect(this.page.getByTestId('list-view')).toBeVisible();
    const response = await this.api.call('GET', `/api/table/${encodeURIComponent(this.table)}:meta`, undefined, [200]);
    return (await response.json()).columns.find(c => c.column_name === 'floor').hidden;
  }

  async changeTarget() {
    this.other = `${this.table} Other`;
    await this.api.createTable({ name: this.other, columns: [{ column_name: 'aisle', column_type: 'Data' }] });
    const picker = this.form.getByLabel('Table', { exact: true });
    await picker.fill(this.other);
    await this.form.getByRole('button', { name: this.other, exact: true }).click();
  }

  async cleared() {
    await expect(this.form.getByLabel('Column', { exact: true })).toHaveValue('');
    await expect(this.form.getByLabel('Setting', { exact: true })).toHaveValue('');
    await expect(this.form.getByLabel('Value', { exact: true })).toHaveValue('');
    await expect(this.form.getByLabel('Setting', { exact: true })).toBeDisabled();
  }

  async saveTableLabel() {
    await this.form.getByLabel('Column', { exact: true }).selectOption('Whole Table');
    await expect(this.form.getByLabel('Setting', { exact: true }).locator('option')).not.toContainText(['Hidden (hidden)']);
    await this.form.getByLabel('Setting', { exact: true }).selectOption('Label (label)');
    await this.form.getByLabel('Value', { exact: true }).fill('Storage shelf');
    await this.form.getByTestId('form-save').click();
    await expect(this.form.getByRole('link', { name: `Open Table: ${this.table}`, exact: true })).toBeVisible();
    this.id = decodeURIComponent(new URL(this.page.url()).pathname.split('/').pop());
  }

  async attemptDuplicate() {
    const prefill = encodeURIComponent(JSON.stringify({ table_name: this.table }));
    await this.page.goto(`/featherbase/admin/Metadata%20Override/new?prefill=${prefill}`);
    await expect(this.form.getByLabel('Column', { exact: true })).toBeEnabled();
    await this.chooseHidden('floor');
    await this.form.getByTestId('form-save').click();
  }

  async attemptOccupiedMove() {
    await this.changeTarget();
    await this.api.call('POST', '/api/table/Metadata%20Override', {
      table_name: this.other, column_name: 'aisle', property: 'hidden', value: 'false',
    }, [201]);
    await this.form.getByLabel('Column', { exact: true }).selectOption('aisle');
    await this.form.getByLabel('Setting', { exact: true }).selectOption('Hidden (hidden)');
    await this.form.getByLabel('Value', { exact: true }).check();
    await this.form.getByTestId('form-save').click();
  }

  async refused() { await expect(this.form.getByTestId('form-banner')).toContainText('Edit the existing adjustment'); }

  async originalCount() {
    const filters = encodeURIComponent(JSON.stringify([['table_name', '=', this.table]]));
    return (await (await this.api.call('GET', `/api/table/Metadata%20Override?filters=${filters}`, undefined, [200])).json()).data.length;
  }

  async move() {
    // Warm the served metadata before moving, rather than testing a cold read.
    await this.api.call('GET', `/api/table/${encodeURIComponent(this.table)}:meta`, undefined, [200]);
    await this.changeTarget();
    await this.form.getByLabel('Column', { exact: true }).selectOption('aisle');
    await this.form.getByLabel('Setting', { exact: true }).selectOption('Hidden (hidden)');
    await this.form.getByLabel('Value', { exact: true }).check();
    await this.form.getByTestId('form-save').click();
    await expect(this.form.getByRole('link', { name: `Open Table: ${this.other}`, exact: true })).toBeVisible();
  }

  async columnHidden(table, column) {
    const meta = await (await this.api.call('GET', `/api/table/${encodeURIComponent(table)}:meta`, undefined, [200])).json();
    return meta.columns.find(c => c.column_name === column).hidden;
  }
}

module.exports = { OverrideEditor };
