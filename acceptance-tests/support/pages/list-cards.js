'use strict';

// A table's list on a phone: one card per row, with "Select all on this
// page" and "Sort by" above the cards and the pager below them.

class ListCards {
  constructor(page) {
    this.page = page;
  }

  cards() {
    return this.page.getByTestId('list-rows').getByRole('listitem');
  }

  card(n) {
    return this.cards().nth(n);
  }

  async count() {
    await this.cards().first().waitFor();
    return this.cards().count();
  }

  /**
   * What one card shows: its title (and where it links), the words beside
   * the title (its status), its quiet meta line, its labelled figures, and
   * the "N more" control's text when it has one.
   */
  async read(n) {
    const card = this.card(n);
    await card.waitFor();
    const shown = await card.evaluate((li) => {
      const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const link = li.querySelector('a');
      const head = link?.closest('.flex-wrap');
      const besideTitle = head ? [...head.children].slice(1).map(text) : [];
      const meta = head?.nextElementSibling?.tagName === 'P' ? text(head.nextElementSibling) : null;
      const figures = [...li.querySelectorAll('dl dt')].map((dt) => ({
        label: text(dt),
        value: text(dt.nextElementSibling),
      }));
      return { title: text(link), href: link?.getAttribute('href') ?? null, besideTitle, meta, figures };
    });
    const more = this.moreControl(n);
    // The row a card is for: the last part of where its title links.
    const rowId = shown.href ? decodeURIComponent(shown.href.split('?')[0].split('/').pop()) : null;
    return { ...shown, rowId, more: (await more.count()) ? ((await more.textContent()) ?? '').trim() : null };
  }

  /** The control on a card that says how many more columns it has. */
  moreControl(n) {
    return this.card(n).getByText(/^\s*\d+ more\b/i);
  }

  /** Opens a card's other columns in place. */
  async showMore(n) {
    const more = this.moreControl(n);
    if ((await more.count()) === 0) throw new Error(`card ${n + 1} has no "N more" control`);
    await more.click();
  }

  /** Whether the page and the cards fit the screen's width (no sideways scrolling). */
  async fitTheScreen() {
    const pageFits = await this.page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    const cardsFit = await this.page
      .getByTestId('list-rows')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    return pageFits && cardsFit;
  }

  /** Opens a card's row by its title. */
  async openRow(n) {
    await this.card(n).locator('a').first().click();
    await this.page.getByTestId('form-view').waitFor();
  }

  // ---- Selecting and acting in bulk ----

  async select(n) {
    await this.card(n).getByTestId('row-check').check();
  }

  async selectAllOnPage() {
    await this.page.getByTestId('select-all').check();
  }

  /** The bulk bar's count, "1 selected", or null when nothing is selected. */
  async selectedCount() {
    const count = this.page.getByTestId('bulk-count');
    return (await count.count()) ? ((await count.textContent()) ?? '').trim() : null;
  }

  /** Sets one column to a value on every selected row, from the bulk bar. */
  async bulkEdit(label, value) {
    await this.page.getByTestId('bulk-edit-field').selectOption({ label });
    await this.page.getByTestId('bulk-edit-value').fill(value);
    const saved = this.page.waitForResponse((r) => r.url().includes(':bulk-edit') && r.request().method() === 'POST');
    await this.page.getByTestId('bulk-edit-apply').click();
    const res = await saved;
    if (!res.ok()) throw new Error(`the bulk edit failed: ${res.status()} ${await res.text()}`);
  }

  // ---- Sorting, nested rows, paging ----

  /** The columns "Sort by" offers, without "Default order". */
  async sortChoices() {
    const options = await this.page.getByTestId('list-sort-by').locator('option').allTextContents();
    return options.map((o) => o.trim()).filter((o) => o !== 'Default order');
  }

  /** Sorts by a column, 'asc' or 'desc', with "Sort by" and its direction button. */
  async sortBy(label, dir) {
    await this.page.getByTestId('list-sort-by').selectOption({ label });
    const toggle = this.page.getByTestId('list-sort-dir');
    await toggle.waitFor();
    const want = dir === 'asc' ? 'ascending' : 'descending';
    if (!((await toggle.getAttribute('aria-label')) ?? '').includes(want)) await toggle.click();
    await this.page.waitForFunction(
      (w) => document.querySelector('[data-testid="list-sort-dir"]')?.getAttribute('aria-label')?.includes(w),
      want,
    );
  }

  /** Every card's title, top card first. */
  async titles() {
    return this.cards().evaluateAll((lis) => lis.map((li) => (li.querySelector('a')?.textContent ?? '').trim()));
  }

  /** The cards' titles once the first one is `first`, or as they stand after a few seconds. */
  async titlesOnceFirstIs(first, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const titles = await this.titles();
      if (titles[0] === first || Date.now() > deadline) return titles;
      await this.page.waitForTimeout(100);
    }
  }

  /** Shows a card's nested rows in place and returns their text. */
  async showNestedRows(n) {
    await this.card(n).getByTestId('row-expand').click();
    const nested = this.card(n).getByTestId('expanded-row');
    await nested.waitFor();
    await nested.getByText(/\S/).first().waitFor();
    return ((await nested.textContent()) ?? '').trim();
  }

  async pageInfo() {
    return ((await this.page.getByTestId('page-info').textContent()) ?? '').trim();
  }

  async nextPage() {
    const before = await this.pageInfo();
    await this.page.getByTestId('next-page').click();
    await this.page.waitForFunction(
      (b) => document.querySelector('[data-testid="page-info"]')?.textContent?.trim() !== b,
      before,
    );
  }
}

module.exports = { ListCards };
