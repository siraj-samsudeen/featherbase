'use strict';

// One row's form.
class FormPage {
  constructor(page) {
    this.page = page;
  }

  /** Opens a row of a table, by the table's address and the row's id. */
  async open(tableSlug, rowId) {
    await this.page.goto(`/featherbase/admin/table/${tableSlug}/row/${encodeURIComponent(rowId)}`);
    await this.page.getByTestId('form-view').waitFor();
  }

  /** Whether the open form shows a field with this label. */
  async showsField(label) {
    const form = this.page.getByTestId('form-view');
    await form.waitFor();
    return (await form.getByLabel(label, { exact: true }).count()) > 0;
  }

  heading() {
    return this.page.getByTestId('form-view').locator('h1');
  }

  /** What the form's heading names the row by. */
  async title() {
    return (await this.heading().innerText()).replace(/^[^:]*:\s*/, '').trim();
  }

  async waitForTitle(title) {
    await this.heading().filter({ hasText: new RegExp(`:\\s*${title}$`) }).waitFor({ timeout: 10_000 });
  }

  /** The notes the field with this label carries (its description and any others). */
  async noteBeside(label) {
    const field = this.page.getByTestId('form-view').getByLabel(label, { exact: true });
    await field.waitFor();
    const ids = ((await field.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
    const notes = [];
    for (const id of ids) notes.push((await this.page.locator(`[id="${id}"]`).innerText()).trim());
    return notes.join(' ');
  }

  /** The offer, beside a field, to connect the table its value points at. */
  offerToConnect(label) {
    return this.page.getByTestId('form-view').getByRole('link', { name: `Connect the ${label.toLowerCase()} table` });
  }

  /** Types a value into a field and saves the row. */
  async setAndSave(field, value) {
    await this.page.locator(`[data-field=${field}]`).fill(value);
    await this.page.getByTestId('form-save').click();
    await this.page.getByTestId('form-banner').filter({ hasText: 'Saved' }).waitFor();
  }

  /** The Rename the form offers when the row's id is out of step with its naming column (#858). */
  async offeredRename() {
    const offer = this.page.getByTestId('form-id-rename');
    await offer.waitFor();
    return (await offer.textContent()).trim();
  }
}

module.exports = { FormPage };
