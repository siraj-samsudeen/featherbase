'use strict';

// The drill pane (#910): one row beside or below whatever the user is
// looking at. Found by its accessible role and name only:
//   - the pane is a complementary landmark (<aside>) named by the row's title
//     ("Enchakkal", "Enchakkal Supermarket (1503)"); the Admin's sidebar is
//     another, unnamed one;
//   - "Points at" and "Pointed at by" are headings over their parts;
//   - each group of rows pointing at it is a button "<Table> <count>" whose
//     open state is aria-pressed; an open group lists its rows as a table;
//   - a linked row offers "Go there" and "Filter" buttons beside its name;
//   - the fields: long text behind "Show more", empty fields under
//     "<n> empty fields", and "Open row page" to edit.

const { expect } = require('playwright/test');

const WAIT = 10_000;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name that starts with `text` (a code may follow: "Enchakkal Supermarket (1503)"), and is not a longer name. */
const startsWith = (text) => new RegExp(`^${escape(text)}(?![\\w ]*\\w)`, 'i');

class DrillPane {
  constructor(page) {
    this.page = page;
  }

  /** The pane showing the row named `title`. */
  pane(title) {
    return this.page.getByRole('complementary', { name: startsWith(title) });
  }

  /** Waits until the pane shows the row named `title`. */
  async shows(title) {
    await expect(this.pane(title), `the drill pane does not show ${title}`).toBeVisible({ timeout: WAIT });
  }

  /** The part of the pane under a heading: "Points at", "Pointed at by". */
  part(title, heading) {
    return this.pane(title).getByRole('heading', { name: heading, exact: true }).locator('xpath=..');
  }

  async pointsAtText(title) {
    const part = this.part(title, 'Points at');
    await part.waitFor({ timeout: WAIT });
    return (await part.innerText()).replace(/\s+/g, ' ');
  }

  /** The button for the group of `table` rows pointing at the row. */
  group(title, table) {
    return this.pane(title).getByRole('button', { name: new RegExp(`^${escape(table)}s?\\s*\\d+$`, 'i') });
  }

  /** The number the group's button counts. */
  async groupCount(title, table) {
    const group = this.group(title, table);
    await group.waitFor({ timeout: WAIT });
    return Number(((await group.textContent()) ?? '').replace(/\D+/g, ''));
  }

  async openGroup(title, table) {
    const group = this.group(title, table);
    await group.click({ timeout: WAIT });
    await expect(group).toHaveAttribute('aria-pressed', 'true', { timeout: WAIT });
  }

  async groupIsOpen(title, table) {
    return (await this.group(title, table).getAttribute('aria-pressed', { timeout: WAIT })) === 'true';
  }

  /** The open group's rows (not its header). */
  groupRows(title) {
    return this.pane(title).getByRole('table').getByRole('row').filter({ has: this.page.getByRole('cell') });
  }

  async groupColumns(title) {
    const headers = this.pane(title).getByRole('table').getByRole('columnheader');
    await headers.first().waitFor({ timeout: WAIT });
    return (await headers.allInnerTexts()).map((t) => t.replace(/[↑↓]/g, '').trim());
  }

  async groupRowTexts(title) {
    await this.groupRows(title).first().waitFor({ timeout: WAIT });
    return this.groupRows(title).allInnerTexts();
  }

  /** Clicks a row of the open group by its name: the pane moves to it. */
  async drillTo(title, rowName) {
    const row = this.groupRows(title).filter({ hasText: rowName }).first();
    await row.getByRole('cell').first().click({ timeout: WAIT });
  }

  async openGroupAsList(title) {
    const pane = this.pane(title);
    await pane.getByRole('link', { name: 'Open as list', exact: true })
      .or(pane.getByRole('button', { name: 'Open as list', exact: true })).first().click({ timeout: WAIT });
  }

  /** Narrows the list underneath to rows with the same linked value (the "Filter" beside it). */
  async filterBy(title, value) {
    const part = this.part(title, 'Points at');
    const holder = part.locator('*', { hasText: value, has: this.page.getByRole('button', { name: 'Filter', exact: true }) }).last();
    await holder.getByRole('button', { name: 'Filter', exact: true }).click({ timeout: WAIT });
  }

  // ---- the row's fields ----

  /** Shows the row's fields, where the pane keeps them behind a "Fields" choice. */
  async showFields(title) {
    await this.pane(title).waitFor({ timeout: WAIT });
    const fields = this.pane(title).getByRole('button', { name: 'Fields', exact: true });
    if ((await fields.count()) > 0 && (await fields.getAttribute('aria-pressed')) !== 'true') await fields.click();
  }

  readMore(title) {
    return this.pane(title).getByRole('button', { name: 'Show more', exact: true });
  }

  emptyFields(title) {
    return this.pane(title).getByText(/^\d+ empty fields?$/);
  }

  openRowPage(title) {
    const pane = this.pane(title);
    return pane.getByRole('link', { name: 'Open row page', exact: true })
      .or(pane.getByRole('button', { name: 'Open row page', exact: true })).first();
  }

  async text(title) {
    return (await this.pane(title).innerText({ timeout: WAIT })).replace(/\s+/g, ' ');
  }

  // ---- where the pane sits ----

  /** Fixes the pane's place: "Right", "Bottom" or "Auto (…)". */
  placeChoice(place) {
    return this.page.getByRole('group', { name: 'Pane place', exact: true }).getByRole('button', { name: place, exact: true });
  }
}

module.exports = { DrillPane, startsWith };
