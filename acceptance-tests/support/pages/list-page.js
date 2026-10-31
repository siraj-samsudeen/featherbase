'use strict';

// A table's list.
class ListPage {
  constructor(page) {
    this.page = page;
  }

  async open(table) {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(table)}`);
    await this.headers().first().waitFor();
  }

  headers() {
    return this.page.getByTestId('list-view').locator('thead [data-testid^="col-"]');
  }

  /** The labels of the columns the list shows after Row ID, in order. */
  async columnLabels() {
    const cells = await this.headers().evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute('data-testid'), text: el.textContent ?? '' })),
    );
    return cells
      .filter((c) => c.id !== 'col-row_id')
      .map((c) => c.text.replace(/[↑↓]/g, '').trim());
  }

  /** Opens the first row's form from the list. */
  async openFirstRow() {
    await this.page.getByTestId('list-rows').locator('tr').first().locator('a').first().click();
  }
}

module.exports = { ListPage };
