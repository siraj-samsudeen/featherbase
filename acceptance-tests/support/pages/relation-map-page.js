'use strict';

const { expect } = require('playwright/test');
const { RowPage } = require('./row-page');

// The relationship map: one row at the center, what it links to, and the
// collections that link back to it. Since #910 it is the "Map" tab of the
// row's page, not a page of its own, and it keeps no row lists: clicking a
// box shows that row in the drill pane, and "Centre here" (a button, also
// "Centre on …"/"Center …") moves the map to it.

const WAIT = 10_000;

class RelationMapPage {
  constructor(page) {
    this.page = page;
  }

  async open(table, rowId) {
    const row = new RowPage(this.page);
    await row.open(table, rowId);
    await row.showTab('Map');
    await this.center().waitFor({ timeout: WAIT });
  }

  center() {
    return this.page.getByTestId('map-center');
  }

  /** The box for the row this one links to in `table`. */
  linkedRow(table) {
    return this.page.getByTestId(`map-forward-${table}`);
  }

  /** The box for the collection of `table` rows that link back to this one. */
  collection(table) {
    return this.page.getByTestId(`map-group-${table}`);
  }

  /** Clicks the row this one links to in `table`. */
  async clickLinked(table) {
    await this.linkedRow(table).click({ timeout: WAIT });
  }

  /** Chooses to centre the map on the row it links to in `table`. */
  async centreOn(table) {
    await this.clickLinked(table);
    // #910 checklist 17: the drill pane's "Focus here" re-centres the map.
    await this.page.getByRole('button', { name: /^(Centre|Center|Focus)( here| on| the map)?/i }).first().click({ timeout: WAIT });
  }

  async centredOn(title) {
    await expect(this.center(), `the map is not centred on ${title}`).toContainText(title, { timeout: WAIT });
  }

  /** The text of a box, once `text` shows in it or the wait runs out. */
  async boxText(box, text) {
    await box.getByText(text).first().waitFor({ timeout: WAIT }).catch(() => {});
    return (await box.textContent()).trim();
  }
}

module.exports = { RelationMapPage };
