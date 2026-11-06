'use strict';

// Retiring a row from its form, and seeing retired rows in a list (#859).
class RetirementPage {
  constructor(page) {
    this.page = page;
  }

  async open(table, rowId) {
    const slug = table.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-');
    await this.page.goto(`/featherbase/admin/table/${slug}/row/${encodeURIComponent(rowId)}`);
    await this.page.getByTestId('form-view').waitFor();
  }

  async openRecordActions() {
    await this.page.getByRole('button', { name: 'Record actions' }).click();
  }

  async retire(reason) {
    await this.openRecordActions();
    await this.page.getByTestId('form-retire').click();
    await this.page.getByTestId('retire-reason').fill(reason);
    await this.page.getByTestId('retire-row-confirm').click();
    await this.page.getByTestId('retired-notice').waitFor();
  }

  async reactivate() {
    await this.openRecordActions();
    await this.page.getByTestId('form-reactivate').click();
    await this.page.getByTestId('retired-notice').waitFor({ state: 'detached' });
  }

  async retiredReason() {
    await this.page.getByTestId('retired-badge').waitFor();
    return (await this.page.getByTestId('retired-reason').innerText()).trim();
  }

  async showRetired() {
    await this.page.getByTestId('list-show-retired-toggle').check();
  }

  rows() {
    return this.page.getByTestId('list-rows').locator('tr');
  }

  /** Each listed row's title: the link that opens it. */
  async rowTitles() {
    return (await this.page.getByTestId('list-rows').locator('tr td a').allInnerTexts()).map((t) => t.trim());
  }

  async retiredRowTitles() {
    return (await this.rows().filter({ has: this.page.getByTestId('retired-badge') }).locator('td a').allInnerTexts()).map((t) => t.trim());
  }
}

module.exports = { RetirementPage };
