'use strict';

// A row's page (#910): its name, the rows it points at and its counted
// groups under the name, then three ways to see it, tabs named "Form", "Map"
// and "Tree". The map is the relationship map (relation-map-page.js).

const { expect } = require('playwright/test');
const { rowHref } = require('../addresses');

const WAIT = 10_000;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class RowPage {
  constructor(page) {
    this.page = page;
  }

  async open(table, rowId) {
    await this.page.goto(rowHref(table, rowId));
    await this.heading().waitFor({ timeout: WAIT });
  }

  /** The page's own heading, which names the row. */
  heading() {
    return this.page.getByRole('main').getByRole('heading', { level: 1 }).first();
  }

  async name() {
    return (await this.heading().innerText()).trim();
  }

  async showTab(name) {
    const tab = this.page.getByRole('tab', { name, exact: true });
    await tab.click({ timeout: WAIT });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: WAIT });
  }

  /** A row the page's row points at, as shown under its name (outside the drill pane). */
  pointsAt(name) {
    const main = this.page.getByRole('main');
    return main.getByRole('button', { name: new RegExp(`^${escape(name)}\\b`) })
      .or(main.getByRole('link', { name: new RegExp(`^${escape(name)}\\b`) })).first();
  }

  /** The counted group of `table` rows pointing at the page's row, under its name. */
  group(table) {
    return this.page.getByRole('main').getByRole('button', { name: new RegExp(`^${escape(table)}s?\\s*\\d+$`, 'i') }).first();
  }

  async groupCount(table) {
    const group = this.group(table);
    await group.waitFor({ timeout: WAIT });
    return Number(((await group.textContent()) ?? '').replace(/\D+/g, ''));
  }

  /** How far below the row's name an element sits (negative: above it). */
  async belowName(locator) {
    const name = await this.heading().boundingBox();
    const box = await locator.boundingBox({ timeout: WAIT });
    if (!name || !box) throw new Error('the row name or the element is not on screen');
    return box.y - (name.y + name.height);
  }
}

module.exports = { RowPage };
