'use strict';

// The path (#910): every drill and filter as a named step. Found by role and
// name: a navigation landmark named "Path" whose steps are links or buttons,
// the current one marked aria-current="step"; "Back", "Forward", "Copy link"
// and "Recent paths" buttons; recent paths as menu items.

const { expect } = require('playwright/test');

const WAIT = 10_000;

class PathBar {
  constructor(page) {
    this.page = page;
  }

  nav() {
    return this.page.getByRole('navigation', { name: 'Path', exact: true });
  }

  /** The step whose name matches `name` (a RegExp or exact text). */
  step(name) {
    const opts = { name, ...(typeof name === 'string' ? { exact: true } : {}) };
    return this.nav().getByRole('link', opts).or(this.nav().getByRole('button', opts)).first();
  }

  async choose(name) {
    await this.step(name).click({ timeout: WAIT });
  }

  async current() {
    const at = this.nav().locator('[aria-current="step"]');
    await at.waitFor({ timeout: WAIT });
    return (await at.innerText()).trim();
  }

  async copyLink() {
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await this.page.getByRole('button', { name: 'Copy link', exact: true }).click({ timeout: WAIT });
    const link = await this.page.evaluate(() => navigator.clipboard.readText());
    expect(link, 'Copy link put no link on the clipboard').toMatch(/^https?:\/\//);
    return link;
  }

  async openRecent() {
    await this.page.getByRole('button', { name: 'Recent paths', exact: true }).click({ timeout: WAIT });
    const items = this.page.getByRole('menuitem');
    await items.first().waitFor({ timeout: WAIT });
    return items;
  }
}

module.exports = { PathBar };
