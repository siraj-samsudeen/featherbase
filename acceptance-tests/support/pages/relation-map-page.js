'use strict';

// The relationship map: one row at the center, what it links to, and the
// collections that link back to it.

class RelationMapPage {
  constructor(page) {
    this.page = page;
  }

  async open(table, rowId) {
    await this.page.goto(`/featherbase/admin/map/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`);
    await this.page.getByTestId('map-center').waitFor();
  }

  /** The box for the row this one links to in `table`. */
  linkedRow(table) {
    return this.page.getByTestId(`map-forward-${table}`);
  }

  /** The box for the collection of `table` rows that link back to this one. */
  collection(table) {
    return this.page.getByTestId(`map-group-${table}`);
  }

  async openCollection(table) {
    await this.collection(table).click();
    await this.page.getByTestId('map-group-rows').waitFor();
  }

  /** The text of each row listed under the map, whatever is listed there. */
  async listedRows() {
    const rows = this.page.getByTestId('map-row');
    await rows.first().waitFor({ timeout: 10_000 });
    return rows.allInnerTexts();
  }

  /** The text of a box, once `text` shows in it or the wait runs out. */
  async boxText(box, text) {
    await box.getByText(text).first().waitFor({ timeout: 10_000 }).catch(() => {});
    return (await box.textContent()).trim();
  }
}

module.exports = { RelationMapPage };
