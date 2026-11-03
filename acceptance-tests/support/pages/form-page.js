'use strict';

// One row's form.
class FormPage {
  constructor(page) {
    this.page = page;
  }

  async open(table, row) {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(table)}/${encodeURIComponent(row)}`);
    await this.page.getByTestId('form-view').waitFor();
  }

  async value(label) {
    return this.page.getByTestId('form-view').getByLabel(label, { exact: true }).inputValue();
  }

  async correct(label, value) {
    await this.page.getByTestId('form-view').getByLabel(label, { exact: true }).fill(value);
    const response = this.page.waitForResponse((res) => res.url().endsWith('/api/save_row') && res.request().method() === 'POST');
    await this.page.getByTestId('form-save').click();
    const res = await response;
    if (!res.ok()) throw new Error(`native save refused: ${res.status()} ${await res.text()}`);
    await this.page.getByTestId('form-status').getByText('Saved', { exact: true }).waitFor();
  }

  /** Whether the open form shows a field with this label. */
  async showsField(label) {
    const form = this.page.getByTestId('form-view');
    await form.waitFor();
    return (await form.getByLabel(label, { exact: true }).count()) > 0;
  }
}

module.exports = { FormPage };
