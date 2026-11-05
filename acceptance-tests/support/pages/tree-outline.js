'use strict';

// A tree of links (#910): on a row page's Tree tab, and a list's tree of all
// rows. Found by role and name only: role=tree; each line is a treeitem
// (aria-expanded when it can unfold), a row's line named by the row's name
// (its code may follow), a group's line by "<Table> <count>". A line unfolds
// by its own "Expand"/"Unfold" button, or with the keyboard (ArrowRight) as
// the ARIA tree pattern has it. A large group offers its other rows by a
// button naming its full count ("Show all 40").

const { expect } = require('playwright/test');

const WAIT = 10_000;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A line's own text: an arrow or mark may lead it; a code may follow a row's name.
const rowName = (name) => new RegExp(`^\\W*${escape(name)}(?![\\w ]*\\w)`, 'i');
const groupName = (table) => new RegExp(`^\\W*${escape(table)}s?\\s*(\\d+)$`, 'i');

class TreeOutline {
  constructor(page) {
    this.page = page;
  }

  tree() {
    return this.page.getByRole('tree').first();
  }

  async waitFor() {
    await this.tree().waitFor({ timeout: WAIT });
  }

  /** The innermost line holding a text that matches `pattern`. */
  line(pattern, within = this.tree()) {
    return within.getByRole('treeitem').filter({ has: this.page.getByText(pattern) }).last();
  }

  /** A row's line, by the row's name (its code may follow). */
  row(name, within) {
    return this.line(rowName(name), within);
  }

  /** A group's line: "Plant 3", "Profit Centre 40". */
  group(table, within) {
    return this.line(groupName(table), within);
  }

  async groupCount(table, within) {
    const label = (within ?? this.tree()).getByText(groupName(table)).last();
    await label.waitFor({ timeout: WAIT });
    return Number(groupName(table).exec((await label.innerText()).trim())?.[1]);
  }

  /** Unfolds a line, unless it is already unfolded. */
  async unfold(item) {
    await item.waitFor({ timeout: WAIT });
    if ((await item.getAttribute('aria-expanded')) === 'true') return;
    const toggle = item.getByRole('button', { name: /^(Expand|Unfold)/i }).first();
    if ((await toggle.count()) > 0) await toggle.click();
    else {
      await item.focus();
      await this.page.keyboard.press('ArrowRight');
    }
    await expect(item, 'the line did not unfold').toHaveAttribute('aria-expanded', 'true', { timeout: WAIT });
  }

  async isUnfolded(item) {
    return (await item.getAttribute('aria-expanded', { timeout: WAIT })) === 'true';
  }

  /** Clicks a row's line by its name (shows it in the drill pane). */
  async click(name) {
    await this.tree().getByText(rowName(name)).last().click({ timeout: WAIT });
  }

  /** The rows a group's line lists. */
  rowsOf(groupLine) {
    return groupLine.getByRole('group').first().getByRole('treeitem');
  }

  /** The tree's top lines. */
  topLines() {
    return this.tree().getByRole('treeitem', { level: 1 });
  }

  showAll(groupLine, count) {
    return groupLine.getByRole('button', { name: new RegExp(`\\b${count}\\b`) }).first();
  }

  async text() {
    return (await this.tree().innerText({ timeout: WAIT })).replace(/\s+/g, ' ');
  }

  /** Where a line sits on screen, to say what is above what. */
  async top(locator) {
    const box = await locator.boundingBox({ timeout: WAIT });
    if (!box) throw new Error('the line is not on screen');
    return box.y;
  }
}

module.exports = { TreeOutline };
