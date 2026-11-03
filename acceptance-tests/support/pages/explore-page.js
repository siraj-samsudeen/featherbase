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
    await search.press('Enter');
  }

  /** The table Explore starts from, as its picker shows it. */
  async startingTable() {
    return this.page.getByTestId('explore-root').inputValue();
  }

  /** The text of each row in the first pane, once they have loaded. */
  async firstPaneRows() {
    const rows = this.page.getByTestId('explore-pane1').getByTestId('explore-row');
    await rows.first().waitFor();
    return rows.allInnerTexts();
  }
}

module.exports = { ExplorePage };
