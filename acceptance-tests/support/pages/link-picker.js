'use strict';

// A field or quick filter that picks a linked row by typing part of its name:
// the box, the rows it offers, and its offer to create a new row.

class LinkPicker {
  /** `box` is the picker's text box; `page` the page it is on. */
  constructor(page, box, columnName) {
    this.page = page;
    this.box = box;
    this.columnName = columnName;
  }

  options() {
    return this.page.getByTestId(`link-options-${this.columnName}`);
  }

  /** Types into the box and waits for the rows it offers. */
  async type(text) {
    await this.box.click();
    await this.box.fill(text);
    await this.options().waitFor({ timeout: 10_000 });
    // The search runs a moment after typing; wait for its answer to settle.
    await this.page.waitForTimeout(400);
  }

  /** The names of the rows offered now. */
  async offered() {
    return (await this.options().getByTestId('link-option').allTextContents()).map((t) => t.trim());
  }

  /** Picks one of the offered rows by its name. */
  async pick(name) {
    const option = this.options().getByTestId('link-option').filter({ hasText: name });
    try {
      await option.first().waitFor({ timeout: 5_000 });
    } catch {
      throw new Error(`"${name}" is not offered; offered: ${JSON.stringify(await this.offered())}`);
    }
    await option.first().click();
  }

  /** Whether the picker offers to create a new row. */
  async offersToCreate() {
    return (await this.options().getByTestId('link-create-new').count()) > 0;
  }

  /** What the box reads. */
  async reads() {
    return this.box.inputValue();
  }
}

module.exports = { LinkPicker };
