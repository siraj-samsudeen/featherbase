'use strict';

// Explore: choosing the table to start from, and the rows it then shows.

class ExplorePage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/featherbase/admin/explore');
    await this.page.getByTestId('explore-root').waitFor();
  }

  /** Types into the table search and presses Enter. */
  async searchAndStart(text) {
    const search = this.page.getByTestId('explore-root-search');
    await search.fill(text);
    // The tables load after the page: wait until the search has narrowed to a match.
    await this.page.getByTestId('explore-root').locator('option', { hasText: /^1 matching table|^\d+ matching tables/ }).waitFor({ state: 'attached' });
    await this.page.getByTestId('explore-root').locator('option:not(:first-child)').first().waitFor({ state: 'attached' });
    await search.press('Enter');
  }

  /** The table Explore starts from, as its picker shows it. */
  async startingTable() {
    await this.page.waitForURL(/[?&]root=/);
    return this.page.getByTestId('explore-root').inputValue();
  }

  /** Starts Explore from a table, picked from "Start from". */
  async startFrom(table) {
    const root = this.page.getByTestId('explore-root');
    await root.locator('option', { hasText: new RegExp(`^${table}$`) }).waitFor({ state: 'attached' });
    await root.selectOption(table);
    await this.pane(1).waitFor();
  }

  /** Adds a table as the chain's second or third step ("Then"), by the table's name. */
  async addStep(n, table) {
    const picker = this.page.getByTestId(`explore-step${n}`);
    const option = picker.locator('option', { hasText: new RegExp(`^${table}\\b`) }).first();
    await option.waitFor({ state: 'attached' });
    await picker.selectOption(await option.getAttribute('value'));
    await this.pane(n).waitFor();
  }

  pane(n) {
    return this.page.getByTestId(`explore-pane${n}`);
  }

  row(n, text) {
    return this.pane(n).getByTestId('explore-row').filter({ hasText: text }).first();
  }

  /** Clicks a row: selects it, or, in the chain's last table, opens it. */
  async clickRow(n, text) {
    await this.row(n, text).click();
  }

  /** The texts of a pane's rows. */
  async rowsOf(n) {
    return this.pane(n).getByTestId('explore-row').allInnerTexts();
  }

  count(n) {
    return this.page.getByTestId(`explore-pane${n}-count`);
  }

  sum(n) {
    return this.page.getByTestId(`explore-pane${n}-sum`);
  }

  selectedRows(n) {
    return this.pane(n).locator('[data-testid="explore-row"][data-selected]');
  }

  chips() {
    return this.page.getByTestId('explore-chip');
  }

  /** The text of each row in the first pane, once they have loaded. */
  async firstPaneRows() {
    const rows = this.page.getByTestId('explore-pane1').getByTestId('explore-row');
    await rows.first().waitFor();
    return rows.allInnerTexts();
  }
}

module.exports = { ExplorePage };
