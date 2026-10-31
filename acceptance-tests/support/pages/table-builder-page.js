'use strict';

// The Table Builder: a new table made by typing its columns.

class TableBuilderPage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/featherbase/admin');
    await this.page.getByTestId('new-table-link').click();
    await this.page.getByTestId('table-builder').waitFor();
  }

  async name(tableName) {
    await this.page.getByTestId('dt-name').fill(tableName);
  }

  columnRows() {
    return this.page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]');
  }

  /**
   * Types each column's label, as a person would. Where the builder flags the
   * derived name as one every table already has (Updated By), it takes the
   * one-click fix the builder offers, as a person would.
   */
  async typeColumns(labels) {
    for (let i = 0; i < labels.length; i++) {
      if (i > 0) await this.page.getByTestId('dt-add-field').click();
      const row = this.columnRows().nth(i);
      await row.locator('[data-rowfield=label]').fill(labels[i]);
      await row.locator('[data-rowfield=label]').blur();
      const fix = row.getByRole('button', { name: /^Use “/ });
      if ((await fix.count()) > 0) await fix.click();
    }
  }

  /** Creates the table and waits for its list. */
  async create() {
    await this.page.getByTestId('dt-create').click();
    await this.page.getByTestId('list-view').waitFor();
  }
}

module.exports = { TableBuilderPage };
