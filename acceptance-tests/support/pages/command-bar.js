'use strict';

const assert = require('node:assert/strict');
const { expect } = require('playwright/test');

const TABLE = 'Sign In Method';
const LIST_PATH = '/featherbase/admin/table/sign-in-method';

class CommandBar {
  constructor(page) { this.page = page; }

  input() { return this.page.getByRole('textbox', { name: 'Search or type a command', exact: true }); }
  dropdown() { return this.page.getByTestId('awesomebar-results'); }

  async visitSignInMethods() {
    const loaded = this.page.waitForResponse(response =>
      decodeURIComponent(new URL(response.url()).pathname) === `/api/table/${TABLE}` &&
      response.request().method() === 'GET');
    await this.page.goto(LIST_PATH);
    const response = await loaded;
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    assert.equal(Array.isArray(result.data), true);
    this.total = result.total;
    await this.expectSignInMethods();
  }

  async expectSignInMethods() {
    assert.equal(decodeURIComponent(new URL(this.page.url()).pathname), decodeURIComponent(LIST_PATH));
    const list = this.page.getByTestId('list-view');
    await list.getByRole('heading', { level: 1, name: /^Sign In Method(?:\s|$)/ }).waitFor();
    // A fresh instance can have no configured methods. Assert the HTTP
    // result's actual count rather than inventing seeded rows.
    await expect(list.getByTestId('list-total')).toHaveText(`${this.total} total`);
    assert.equal(await list.getByTestId('list-rows-error').count(), 0);
  }

  async open() {
    await this.page.keyboard.press('Meta+k');
    assert.equal(await this.input().evaluate(element => element === document.activeElement), true);
  }

  async searchSignInMethods() {
    await this.open();
    await this.input().fill(TABLE);
    await this.page.getByTestId('awesomebar-table').filter({ hasText: TABLE }).waitFor();
    await this.input().press('Enter');
  }

  async expectUnobstructedList() {
    await this.expectSignInMethods();
    await this.dropdown().waitFor({ state: 'hidden' });
  }

  async expectHistoryOnReopen() {
    await this.open();
    await this.page.getByTestId('awesomebar-recents').waitFor();
    await this.page.getByTestId('awesomebar-recents')
      .getByTestId('awesomebar-recent').filter({ hasText: TABLE }).first().waitFor();
  }

  async replaySignInMethodSearch() {
    await this.open();
    await this.input().fill('Sign In');
    await this.page.getByTestId('awesomebar-recent-search').filter({ hasText: TABLE }).click();
  }

  async expectEditableSearchAndRun() {
    assert.equal(await this.input().inputValue(), TABLE);
    assert.equal(await this.input().evaluate(element => element === document.activeElement), true);
    await this.dropdown().waitFor();
    // Edit with the keyboard without clicking/refocusing: replay must leave
    // the complete query in the focused, usable input.
    await this.input().press('End');
    await this.page.keyboard.type(' ');
    assert.equal(await this.input().inputValue(), `${TABLE} `);
    await this.page.keyboard.press('Backspace');
    assert.equal(await this.input().inputValue(), TABLE);
    await this.page.keyboard.press('Enter');
    await this.page.waitForFunction(() =>
      document.querySelector('[data-testid="awesomebar"] input')?.value === '');
    await this.expectUnobstructedList();
  }

  async searchPerson() {
    await this.page.goto('/featherbase/admin/all-tables');
    await this.page.getByTestId('all-tables-link').waitFor();
    await this.open();
    await this.input().fill('Person');
    await this.page.getByRole('option', { name: 'Person Table definition', exact: true }).waitFor();
  }

  async choosePersonResult(kind) {
    // Person's own new-row choice: an installed app may offer another, such as "+ New Finance person row".
    const target = kind === 'new'
      ? this.page.getByTestId('awesomebar-new').and(this.page.getByRole('option', { name: '+ New Person row', exact: true }))
      : this.page.getByRole('option', { name: 'Person Table definition', exact: true });
    const count = await this.dropdown().getByRole('option').count();
    for (let i = 0; i < count; i++) {
      await this.input().press('ArrowDown');
      if (await target.getAttribute('aria-selected') === 'true') break;
    }
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await this.input().press('Enter');
  }

  async expectPersonForm(kind) {
    await expect(this.page).toHaveURL(new RegExp(kind === 'new' ? '/admin/table/person/new$' : '/admin/table/table/row/Person$'));
    await this.page.getByTestId('form-view').waitFor();
    await this.dropdown().waitFor({ state: 'hidden' });
  }

  async replacePersonSearch() {
    await this.input().fill('Sign In Meth');
    await this.input().press('Enter');
  }

  async expectReplacementSearch() {
    await expect(this.page).not.toHaveURL(/\/all-tables$/);
    assert.notEqual(decodeURIComponent(new URL(this.page.url()).pathname), '/featherbase/admin/table/table/row/Person');
  }

  async visitAdmin() {
    await this.page.goto('/featherbase/admin');
    await this.input().waitFor();
  }

  async searchDestination(label) {
    await this.open();
    const response = this.page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/search' && url.searchParams.get('q') === label;
    });
    await this.input().fill(label);
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  destination(label) {
    // Records and "new row" actions can share a Table's label but are not
    // independently openable destinations (for example System Settings).
    return this.dropdown().getByRole('option')
      .and(this.page.locator(':not([data-testid="awesomebar-doc"]):not([data-testid="awesomebar-new"])'))
      .filter({ hasText: label });
  }

  async findDestination(label) {
    await this.searchDestination(label);
    await expect(this.destination(label)).toHaveCount(1);
    await this.destination(label).click();
  }

  async expectInstanceHealth() {
    await expect(this.page).toHaveURL(/\/featherbase\/admin\/instance-health$/);
    await expect(this.page.getByTestId('instance-health').getByRole('heading', { name: 'Instance health', exact: true })).toBeVisible();
    await expect(this.dropdown()).toBeHidden();
  }

  async expectExistingSettings() {
    await expect(this.page).toHaveURL(/\/featherbase\/admin\/table\/system-settings$/);
    const form = this.page.getByTestId('form-view');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('form-status')).toHaveText('Saved');
    await expect(form.getByRole('heading', { level: 1 })).toContainText('System Settings');
    await expect(this.dropdown()).toBeHidden();
  }

  async expectDestinationAbsent(label) {
    await expect(this.dropdown().getByRole('option').filter({ hasText: label })).toHaveCount(0);
  }

  async searchAccess() {
    await this.visitAdmin();
    // Hold the real public search response, not a production function spy.
    // Local destination matches let the user dismiss while records are in
    // flight; releasing them afterwards must not reopen the dropdown.
    let ready;
    const held = new Promise((resolve, reject) => { ready = { resolve, reject }; });
    await this.page.route('**/api/search?*', async route => {
      try {
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        this.lateRecords = { route, response };
        ready.resolve();
      } catch (error) { ready.reject(error); }
    }, { times: 1 });
    await this.open();
    await this.input().fill('access');
    await held;
    await expect(this.dropdown()).toBeVisible();
    await expect(this.dropdown().getByRole('option').first()).toBeVisible();
  }

  async clickOutside() {
    // A real pointer on nonfocusable page space: do not use blur() or a
    // navigation/button click, which would hide broken outside dismissal.
    const point = await this.page.evaluate(() => {
      const bar = document.querySelector('[data-testid="awesomebar"]');
      for (let y = innerHeight - 20; y > innerHeight / 2; y -= 20) {
        for (let x = innerWidth - 20; x > innerWidth / 2; x -= 20) {
          const target = document.elementFromPoint(x, y);
          if (target && !bar.contains(target) &&
              !target.closest('a, button, input, textarea, select, [tabindex], [contenteditable="true"]')) return { x, y };
        }
      }
      throw new Error('No nonfocusable outside page space found');
    });
    await this.page.mouse.click(point.x, point.y);
  }

  async escapeFromResult() {
    await this.input().focus();
    await this.input().press('Tab');
    // Prove actual DOM focus moved to an offered result, not just arrow-key
    // selection (aria-activedescendant leaves focus in the input).
    await expect(this.dropdown().getByRole('option').first()).toBeFocused();
    await this.page.keyboard.press('Escape');
  }

  async escapeFromSearch() {
    await this.input().press('Escape');
  }

  async expectPreservedDismissal() {
    await expect(this.dropdown()).toBeHidden();
    await expect(this.input()).toHaveValue('access');
    const delivered = this.page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/search' && url.searchParams.get('q') === 'access';
    });
    await this.lateRecords.route.fulfill({ response: this.lateRecords.response });
    await (await delivered).finished();
    // Allow the browser to consume and render the delivered response.
    await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(this.dropdown()).toBeHidden();
    await expect(this.input()).toHaveValue('access');
  }

  async reopenPreservedSearch(shortcut = false) {
    if (shortcut) await this.open();
    else await this.input().focus();
    await expect(this.input()).toHaveValue('access');
    await expect(this.dropdown()).toBeVisible();
    await expect(this.dropdown().getByRole('option').first()).toBeVisible();
  }
}

module.exports = { CommandBar };
