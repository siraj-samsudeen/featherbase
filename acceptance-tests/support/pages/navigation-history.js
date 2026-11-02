'use strict';

const { expect } = require('playwright/test');
const { acceptanceSql } = require('../stack');

class NavigationHistory {
  constructor(page) { this.page = page; }

  async open() {
    const summary = this.page.waitForResponse('**/api/events/summary');
    await this.page.goto('/featherbase/admin');
    await summary;
    await this.page.getByTestId('admin-sidebar').waitFor();
  }

  async remember(label = 'Person') {
    await this.page.evaluate(label => {
      const user = JSON.parse(localStorage.getItem('fc_user'));
      localStorage.setItem(`fc-recents:${user.row_id}`, JSON.stringify([{
        kind: 'list', key: `list:${label}?`, label,
        path: `/featherbase/admin/${label}`, visits: [Date.now() - 2000, Date.now() - 1000],
      }]));
    }, label);
  }

  async forget() {
    const user = await this.page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
    await acceptanceSql('delete from featherbase.user_event where created_by = $1', [user]);
  }

  async savePersonVisit() {
    const token = await this.page.evaluate(() => localStorage.getItem('fc_token'));
    const response = await this.page.request.post('/api/events', {
      headers: { Authorization: `Bearer ${token}` },
      data: { events: [{ kind: 'list', key: 'list:Person?', label: 'Person', path: '/featherbase/admin/Person', at: Date.now() - 1000 }] },
    });
    expect(response.ok()).toBeTruthy();
  }

  async reload() {
    const summary = this.page.waitForResponse('**/api/events/summary');
    await this.page.reload();
    await summary;
    await this.page.getByTestId('admin-sidebar').waitFor();
  }

  async holdSummary() {
    this.release = null;
    const gate = new Promise(resolve => { this.release = resolve; });
    const captured = new Promise(resolve => { this.captured = resolve; });
    await this.page.route('**/api/events/summary', async route => {
      const response = await route.fetch();
      this.captured();
      await gate;
      await route.fulfill({ response });
    });
    await this.page.reload();
    await captured;
    await this.page.getByTestId('admin-sidebar').waitFor();
  }

  async visitPerson() {
    // A client navigation keeps the initial summary in flight.
    await this.page.getByRole('textbox', { name: 'Search or type a command' }).fill('Person');
    await this.page.getByTestId('awesomebar-table').and(this.page.locator('[href="/featherbase/admin/Person"]')).click();
    await expect(this.page).toHaveURL(/\/admin\/Person$/);
    await expect.poll(() => this.page.evaluate(() => {
      const user = JSON.parse(localStorage.getItem('fc_user'));
      return JSON.parse(localStorage.getItem(`fc-recents:${user.row_id}`) ?? '[]').some(entry => entry.label === 'Person');
    })).toBe(true);
    const summary = this.page.waitForResponse('**/api/events/summary');
    this.release();
    await summary;
  }

  async failSummary() {
    await this.page.route('**/api/events/summary', route => route.abort());
    await this.page.reload();
    await this.page.getByTestId('admin-sidebar').waitFor();
  }

  async expectDestination(label, present) {
    const sidebar = this.page.getByTestId('sidebar-recents').locator(`a[href="/featherbase/admin/${label}"]`);
    await expect(sidebar).toHaveCount(present ? 1 : 0);
    await this.page.getByRole('textbox', { name: 'Search or type a command' }).click();
    await this.page.getByRole('textbox', { name: 'Search or type a command' }).fill('');
    await expect(this.page.getByTestId('awesomebar-recent').filter({ hasText: label })).toHaveCount(present ? 1 : 0);
  }
}

module.exports = { NavigationHistory };
