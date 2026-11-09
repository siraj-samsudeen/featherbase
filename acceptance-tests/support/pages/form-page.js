'use strict';

const { rowHref } = require('../addresses');

// One row's form.
class FormPage {
  constructor(page) {
    this.page = page;
  }

  /** Opens a row of a table, by the table's address and the row's id. */
  async open(tableSlug, rowId) {
    await this.page.goto(`/featherbase/admin/table/${encodeURIComponent(tableSlug.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-'))}/row/${encodeURIComponent(rowId)}`);
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

  // ---- A row's fields as read (#795) ----

  form() {
    return this.page.getByTestId('form-view');
  }

  /** Opens a row by its table's name and waits for its fields. */
  async openRow(table, rowId) {
    await this.page.goto(rowHref(table, rowId));
    await this.form().locator('[data-form-field]').first().waitFor({ timeout: 10_000 });
  }

  field(label) {
    return this.form().locator(`[data-form-field][data-label="${label}"]`);
  }

  /** The value as shown, with how it is set: its text, even-width figures, one line or wrapping, whether it is a link. */
  async valueOf(label) {
    const value = this.field(label).locator('[data-value]');
    await value.waitFor();
    return value.evaluate((e) => {
      const style = getComputedStyle(e);
      const box = e.matches('input, textarea') ? e : null;
      return {
        text: (box ? box.value : e.textContent).trim(),
        kind: e.dataset.value,
        evenFigures: style.fontVariantNumeric.includes('tabular-nums'),
        oneLine: box ? box.tagName === 'INPUT' : style.whiteSpace === 'nowrap',
        link: Boolean(e.querySelector('a') || e.closest('a')),
      };
    });
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
