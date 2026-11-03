'use strict';

// One row's form.
class FormPage {
  constructor(page) {
    this.page = page;
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
  // ---- How the fields are arranged (#795) ----

  form() {
    return this.page.getByTestId('form-view');
  }

  /** Opens a row and waits for its fields. */
  async open(table, rowId) {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`);
    await this.form().locator('[data-form-field]').first().waitFor({ timeout: 10_000 });
  }

  /** Picks an arrangement: importance, type, filled, links or source. */
  async arrangeBy(mode) {
    await this.form().getByTestId(`arrange-${mode}`).click();
    await this.form().locator(`[data-arrangement="${mode}"]`).waitFor();
  }

  async showColumns(count) {
    await this.form().getByTestId(`arrange-columns-${count}`).click();
  }

  /** The labels of the fields shown, in the order they are shown; folded fields and the foot line are not fields. */
  async fieldLabels() {
    return this.form().locator('[data-form-field]:visible').evaluateAll((els) => els.map((e) => e.dataset.label));
  }

  field(label) {
    return this.form().locator(`[data-form-field][data-label="${label}"]`);
  }

  emptyFieldsLine() {
    return this.form().getByTestId('empty-fields-toggle');
  }

  async openEmptyFields() {
    await this.emptyFieldsLine().click();
  }

  footLine() {
    return this.form().getByTestId('bookkeeping-line');
  }

  /** The kind of group (number, link, ...) the field with this label sits in. */
  async groupOf(label) {
    return this.field(label).evaluate((e) => e.closest('[data-testid="field-group"]')?.dataset.group ?? null);
  }

  /** The type mark beside the field's name, or null. */
  async typeMarkOf(label) {
    return this.field(label).locator('[data-type-mark]').first().getAttribute('data-type-mark').catch(() => null);
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

  /** The left edge of each field shown, in order. */
  async fieldLefts() {
    return this.form().locator('[data-form-field]:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  }

  section(n) {
    return this.form().getByTestId(`form-section-${n}`);
  }
}

module.exports = { FormPage };
