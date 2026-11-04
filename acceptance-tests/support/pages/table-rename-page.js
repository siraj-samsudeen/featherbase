'use strict';

// Renaming a Table from its list, and the page its old address shows (#871).

const slug = (table) => table.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-');

class TableRenamePage {
  constructor(page) {
    this.page = page;
  }

  /** Renames the Table whose list is open and waits for its list under the new name. */
  async rename(table, to) {
    await this.page.goto(`/featherbase/admin/table/${slug(table)}`);
    await this.page.getByRole('button', { name: 'Table administration', exact: true }).click();
    await this.page.getByTestId('rename-table').click();
    const dialog = this.page.getByTestId('rename-table-dialog');
    await dialog.getByTestId('rename-table-input').fill(to);
    await dialog.getByTestId('rename-table-confirm').click();
    await this.page.waitForURL(`**/featherbase/admin/table/${slug(to)}`);
    await this.page.getByTestId('list-view').waitFor();
  }

  /** Opens a Table's address as typed, without waiting for a list. */
  async openAddress(table) {
    await this.page.goto(`/featherbase/admin/table/${slug(table)}`);
  }

  /** What the renamed Table's old address says, and the name of its link. */
  async renamedNotice() {
    const notice = this.page.getByTestId('table-renamed');
    await notice.waitFor();
    return { text: (await notice.innerText()).replace(/\s+/g, ' '), link: (await notice.getByRole('link').innerText()).trim() };
  }
}

module.exports = { TableRenamePage };
