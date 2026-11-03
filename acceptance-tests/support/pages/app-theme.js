'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { restartAcceptance, REPO_ROOT } = require('../stack');

// #668: the bar-proof test app (test-apps/fixtures/bar-proof) follows the
// person's theme through the bar's documented attribute and event, and shows
// what it was told. Its own colours and `data-theme` stay its own.
const PAGE = '/barproof/';

class AppTheme {
  constructor(page) { this.page = page; }

  static async install(api) {
    // The fixture is a test app, so the acceptance server is told where it is
    // (as the e2e stack is). The setting, and the installed app, stay for the
    // rest of the run (until a scenario resets the database): no scenario
    // today lists every available or installed app. One that does should
    // reset first, as the base-install scenarios do.
    await restartAcceptance({ FEATHERBASE_APP_PATHS: JSON.stringify([path.join(REPO_ROOT, 'test-apps/fixtures/bar-proof')]) });
    await api.call('POST', '/api/install_app', { name: 'barproof' }, [201, 409], 'install the bar-proof app');
  }

  /** The device's own setting, as the browser reports it. */
  async deviceIs(scheme) { await this.page.emulateMedia({ colorScheme: scheme }); }

  /** The person's stored choice, saved as they would save it, before the page is opened. */
  async choose(theme) {
    await this.page.goto('/featherbase/account/sign-in-methods');
    const status = await this.page.evaluate(async (choice) => {
      const res = await fetch('/api/set_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('fc_token')}` },
        body: JSON.stringify({ theme: choice }),
      });
      return res.status;
    }, theme);
    assert.equal(status, 200, `saving the ${theme} theme`);
  }

  async open() {
    await this.page.goto(PAGE);
    await this.page.locator('#bar-proof-page').waitFor();
    await this.page.getByTestId('session-user').waitFor();
  }

  /** Marks this document, so a reload (a new document) would lose the mark. */
  async markDocument() { await this.page.evaluate(() => { window.__themeProof = true; }); }

  async switchInBar(theme) { await this.page.getByTestId(`theme-${theme}`).click(); }

  async expectApp(theme) {
    const follower = this.page.locator('#theme-follower');
    await follower.filter({ hasText: theme }).waitFor({ timeout: 10_000 });
    const seen = await this.page.evaluate(() => {
      const box = getComputedStyle(document.getElementById('theme-follower')).backgroundColor;
      const [r, g, b] = box.match(/\d+/g).map(Number);
      return {
        told: document.getElementById('theme-follower').textContent,
        painted: (r + g + b) / 3 > 128 ? 'light' : 'dark',
        ownTheme: document.documentElement.getAttribute('data-theme'),
        ownBackground: getComputedStyle(document.body).backgroundColor,
      };
    });
    assert.deepEqual(seen, { told: theme, painted: theme, ownTheme: 'app-owned', ownBackground: 'rgb(250, 245, 230)' });
  }

  async expectSameDocument() {
    assert.equal(await this.page.evaluate(() => window.__themeProof === true), true, 'the page was reloaded');
  }
}

module.exports = { AppTheme };
