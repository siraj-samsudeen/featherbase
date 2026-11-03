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
