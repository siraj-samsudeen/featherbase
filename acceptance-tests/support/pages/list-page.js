'use strict';

// A table's list, with its "Show columns" menu.

const SORT_ARROWS = { '↑': 'asc', '↓': 'desc' };

class ListPage {
  constructor(page) {
    this.page = page;
  }

  async open(table) {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(table)}`);
    await this.headers().first().waitFor();
  }

  /** Leaves the list for the Admin's home page. */
  async leave() {
    await this.page.goto('/featherbase/admin');
  }

  headers() {
    return this.page.getByTestId('list-view').locator('thead [data-testid^="col-"]');
  }

  async headerCells() {
    return this.headers().evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute('data-testid'), text: el.textContent ?? '' })),
    );
  }

  /** Every column header the list shows, Row ID included, in order. */
  async allColumnLabels() {
    return (await this.headerCells()).map((c) => c.text.replace(/[↑↓]/g, '').trim());
  }

  /** The labels of the columns the list shows after Row ID, in order. */
  async columnLabels() {
    return (await this.headerCells())
      .filter((c) => c.id !== 'col-row_id')
      .map((c) => c.text.replace(/[↑↓]/g, '').trim());
  }

  /** Which column the list is sorted by, and which way: { column, dir } or null. */
  async sorting() {
    for (const c of await this.headerCells()) {
      const arrow = c.text.trim().slice(-1);
      if (SORT_ARROWS[arrow]) return { column: c.text.replace(/[↑↓]/g, '').trim(), dir: SORT_ARROWS[arrow] };
    }
    return null;
  }

  async headerFor(label) {
    const cells = await this.headerCells();
    const at = cells.findIndex((c) => c.text.replace(/[↑↓]/g, '').trim() === label);
    if (at < 0) throw new Error(`the list has no column ${label}`);
    return { header: this.headers().nth(at), name: cells[at].id.replace(/^col-/, '') };
  }

  /** Sorts by a column, 'asc' or 'desc', the way a person does: clicking its header. */
  async sortBy(label, dir) {
    for (let clicks = 0; clicks < 2; clicks++) {
      const now = await this.sorting();
      if (now?.column === label && now.dir === dir) return;
      const { header } = await this.headerFor(label);
      await this.saving(() => header.click());
    }
    const now = await this.sorting();
    if (now?.column !== label || now.dir !== dir) throw new Error(`could not sort by ${label} ${dir}`);
  }

  /** The values one column shows, top row first. */
  async columnValues(label) {
    const { name } = await this.headerFor(label);
    return this.rows().locator(`[data-testid="cell-${name}"]`).allTextContents();
  }

  /**
   * The values one column shows once they are in this order ('asc' or
   * 'desc'), or as they stand after a few seconds: rows arrive after the
   * headers, and a saved sort applies once the arrangement has loaded.
   */
  async columnValuesOnceSorted(label, dir, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const values = await this.columnValues(label);
      const sorted = [...values].sort((a, b) => (dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
      if ((values.length && values.join('\n') === sorted.join('\n')) || Date.now() > deadline) return values;
      await this.page.waitForTimeout(100);
    }
  }

  rows() {
    return this.page.getByTestId('list-rows').locator('tr');
  }

  /** The text of each row, top row first. */
  async rowTexts() {
    return this.rows().allTextContents();
  }

  /** Opens the first row's form from the list. */
  async openFirstRow() {
    await this.rows().first().locator('a').first().click();
  }

  // ---- "Show columns" ----

  async openColumnsMenu() {
    const popup = this.page.getByTestId('list-columns-popup');
    if (!(await popup.isVisible())) await this.page.getByTestId('list-columns').click();
    await popup.waitFor();
    return popup;
  }

  async menuChoices() {
    return (await this.openColumnsMenu()).getByRole('checkbox');
  }

  /** The columns the menu offers, in order. */
  async offeredColumns() {
    const choices = await this.menuChoices();
    return choices.evaluateAll((els) => els.map((el) => (el.closest('label')?.textContent ?? '').trim()));
  }

  async choiceFor(label) {
    const choice = (await this.openColumnsMenu()).getByRole('checkbox', { name: label, exact: true });
    if ((await choice.count()) === 0)
      throw new Error(
        `"Show columns" does not offer ${label}; it offers: ${(await this.offeredColumns()).join(', ')}`,
      );
    return choice;
  }

  /** Switches a column on in this person's view, waiting until it is saved. */
  async switchOn(label) {
    const choice = await this.choiceFor(label);
    if (!(await choice.isChecked())) await this.saving(() => choice.check());
  }

  /** Switches a column off in this person's view, waiting until it is saved. */
  async switchOff(label) {
    const choice = await this.choiceFor(label);
    if (await choice.isChecked()) await this.saving(() => choice.uncheck());
  }

  /** Switches off every column the menu lets the person switch off. */
  async switchOffEverything() {
    const choices = await this.menuChoices();
    for (let i = 0; i < (await choices.count()); i++) {
      const choice = choices.nth(i);
      if ((await choice.isChecked()) && (await choice.isEnabled())) await this.saving(() => choice.uncheck());
    }
  }

  /** Does an action that saves this person's arrangement of the list, and waits for the save. */
  async saving(action) {
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/api/user_settings/') && r.request().method() === 'PUT',
    );
    await action();
    const res = await saved;
    if (!res.ok()) throw new Error(`the list's arrangement was not saved: ${res.status()}`);
  }
}

module.exports = { ListPage };
