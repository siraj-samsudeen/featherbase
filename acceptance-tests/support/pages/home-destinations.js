'use strict';
const { expect } = require('playwright/test');
const { execFileSync } = require('node:child_process');
const { Api } = require('../api');
const { AppNavigation } = require('./app-navigation');
const { tableHref, rowHref } = require('../../../packages/shared/src/app-routes.ts');
const { acceptanceSql, restartAcceptance, isolatedEnvironment, REPO_ROOT } = require('../stack');

const PLANT = 'tasker.homeplant';
const DEPOT = 'tasker.homedepot';
class HomeDestinations {
  constructor(page) { this.page = page; this.table = PLANT; this.events = []; }
  async lifecycle(operation) {
    execFileSync('pnpm', ['--filter', 'server', 'exec', 'tsx', '../../acceptance-tests/support/fixtures/home-destinations.ts', operation],
      { cwd: REPO_ROOT, env: isolatedEnvironment(), timeout: 60000, stdio: 'pipe' });
    await restartAcceptance();
    this.admin = await AppNavigation.appApi(await Api.asSystemManager(), 'tasker');
  }
  async setup() {
    this.admin = await Api.asSystemManager();
    await AppNavigation.install(this.admin);
    await this.lifecycle('setup');
    await this.admin.createTable({ name: 'Resume Supplier', columns: [{ column_name: 'title', column_type: 'Data' }] });
    await this.page.goto('/featherbase/admin');
    this.user = await this.page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
    this.token = await this.page.evaluate(() => localStorage.getItem('fc_token'));
    for (const [row_id, title] of [['north', 'North depot'], ['south', 'South depot']])
      await this.admin.call('POST', `/api/table/${PLANT}`, { row_id, title }, [201], 'fixture row');
  }
  async call(method, path, data, headers = {}) {
    const response = await this.page.request.fetch(path, { method, data, headers: { ...this.admin.headers, Authorization: `Bearer ${this.token}`, ...headers } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response;
  }
  async visit(row, table = this.table) {
    const response = await this.call('GET', `/api/table/${encodeURIComponent(table)}${row ? `/${row}` : ':meta'}`, undefined, { 'X-Navigation-Visit': '1' });
    const event = { kind: row ? 'row' : 'list', key: row ? `row:${table}/${row}` : `list:${table}?`,
      label: row || table, sub: row ? table : undefined, path: row ? rowHref(table, row) : tableHref(table),
      claim: response.headers()['x-navigation-claim'], at: Date.now() };
    await this.call('POST', '/api/events', { events: [event] });
    this.events.push(event);
    return event;
  }
  async visits(rows = ['north']) { for (const row of rows) await this.visit(row); }
  async listVisits() { await this.visit(null, 'Resume Supplier'); await this.visit(null); }
  async search() { await this.call('POST', '/api/events', { events: [{ kind: 'search', key: 'search:depot', label: 'depot', path: '' }] }); }
  async removeRow() {
    const response = await this.admin.call('GET', `/api/table/${this.table}/north`, undefined, [200], 'read row');
    await this.admin.call('DELETE', `/api/table/${this.table}/north?updated_at=${encodeURIComponent((await response.json()).updated_at)}`, undefined, [200], 'delete row');
  }
  async removeTable() { await this.lifecycle('delete'); }
  async recreateTable() { await this.removeTable(); await this.lifecycle('recreate'); await this.replaceRow(); }
  async replaceRow() { await this.admin.call('POST', `/api/table/${PLANT}`, { row_id: 'north', title: 'Replacement row' }, [201], 'replacement row'); }
  async renameTable(reuse = false) {
    await this.lifecycle('rename'); this.table = DEPOT;
    if (reuse) await this.lifecycle('recreate');
  }
  async renameRow() {
    await this.admin.call('POST', `/api/table/${this.table}/north:rename`, { new_name: 'central' }, [200], 'rename row');
  }
  async title(title = 'Central depot', row = 'north') {
    const loaded = await this.admin.row(this.table, row);
    await this.admin.call('PATCH', `/api/table/${this.table}/${row}`, { title, updated_at: loaded.updated_at }, [200], 'change title');
  }
  async remember() {
    await this.visits();
    await this.page.evaluate(events => {
      const user = JSON.parse(localStorage.getItem('fc_user')).row_id;
      localStorage.setItem(`fc-recents:${user}`, JSON.stringify(events.map(e => ({ ...e, visits: [e.at] }))));
    }, this.events);
  }
  async open() {
    const response = this.page.waitForResponse(r => r.url().endsWith('/api/home_resume'));
    await this.page.goto('/featherbase/admin');
    await response;
    await this.page.getByTestId('activity-feed').waitFor();
  }
  tile(kind = 'row') { return this.page.getByTestId(`resume-tile-${kind}`); }
  async row(title) { await expect(this.tile()).toContainText(title); }
  async missingRow() { await expect(this.tile()).toHaveCount(0); }
  async supplier() { await expect(this.tile('view')).toContainText('Resume Supplier'); }
  async noPlant() { await expect(this.page.getByTestId('resume-strip').filter({ hasText: PLANT })).toHaveCount(0); }
  async noNorth() { await expect(this.tile()).not.toContainText('North depot'); }
  async noConfidential() { await expect(this.page.getByTestId('home-page')).not.toContainText('Confidential depot'); }
  async namedDepot() { await expect(this.tile()).toContainText(DEPOT); await expect(this.tile()).not.toContainText(PLANT); }
  async notReplacement() { await expect(this.page.getByTestId('form-view')).not.toContainText('Replacement row'); }
  async noninteractive() { await expect(this.page.getByTestId('feed-item').first().locator('button,a')).toHaveCount(0); }
  async historyTime() { await expect(this.page.getByTestId('feed-item').first().locator('time')).toHaveAttribute('datetime', new Date(this.events.at(-1).at).toISOString()); }
  async searchAvailable() { await expect(this.tile('search')).toContainText('depot'); }
  async noResume() { await expect(this.page.getByTestId('resume-strip')).toHaveCount(0); }
  async allKinds() { for (const kind of ['row', 'view', 'search']) await expect(this.tile(kind)).toBeVisible(); }
  async assertCurrentRow() { expect(await (await this.admin.call('GET', `/api/table/${DEPOT}/north`, undefined, [200], 'renamed row')).json()).toMatchObject({ title: 'North depot' }); }
  async newerLegacyRow() { await this.removeRow(); await this.replaceRow(); }
  async history() { await expect(this.page.getByTestId('feed-item').first()).toBeVisible(); }
  async unavailable() {
    await this.history();
    const item = this.page.getByTestId('feed-item').first();
    await expect(item).toContainText('Unavailable destination');
    await expect(item.locator('button,a')).toHaveCount(0);
    await expect(item).not.toContainText('Table deleted');
    await expect(item).not.toContainText('Confidential depot');
  }
  async deleted() {
    await this.history();
    const item = this.page.getByTestId('feed-item').first();
    await expect(item).toContainText(PLANT);
    await expect(item.locator('.line-through')).toContainText(PLANT);
    await expect(item.locator('button,a')).toHaveCount(0);
  }
  async resume(table = DEPOT, row = 'north', title = 'North depot') {
    await this.row(title);
    await this.tile().click();
    await expect(this.page).toHaveURL(url => url.pathname === rowHref(table, row));
    await expect(this.page.getByTestId('form-view')).toContainText(title);
  }
  async legacy() {
    const event = await this.visit('north');
    await acceptanceSql('update featherbase.user_event set destination = null where created_by = $1', [this.user]);
    this.legacyAt = event.at;
    await this.evidence('earlier');
    this.snapshot = await acceptanceSql('select * from featherbase.user_event where created_by = $1 order by row_id', [this.user]);
  }
  async evidence(value) {
    const time = value === 'earlier' ? this.legacyAt - 10000 : value === 'equal to the visit time' ? this.legacyAt : value === 'unknown' ? null : this.legacyAt + 10000;
    // created_at is NOT NULL; infinity is known unusable creation evidence.
    await acceptanceSql('update featherbase.table_def set created_at = $1 where name = $2', [time === null ? 'infinity' : new Date(time), PLANT]);
    await acceptanceSql('update tasker.homeplant set created_at = $1', [new Date(this.legacyAt - 10000)]);
  }
  async snapshotHistory() { this.snapshot = await acceptanceSql('select * from featherbase.user_event where created_by = $1 order by row_id', [this.user]); }
  async unchanged() { expect(await acceptanceSql('select * from featherbase.user_event where created_by = $1 and row_id = any($2) order by row_id', [this.user, this.snapshot.map(r => r.row_id)])).toEqual(this.snapshot); }
  async deny(rowOnly = false) {
    // Real permissions: remove System Manager and use an own-row read grant
    // for row denial, or no Table read grant for Table denial.
    const role = `Home reader ${this.user}`;
    await this.admin.call('POST', '/api/save_row', { table: 'Role', row: { row_id: role } }, [201], 'reader role');
    await this.admin.call('POST', '/api/save_row', { table: 'Permission', row: { ref_table: 'Resume Supplier', role, can_read: true } }, [201], 'keep Home access');
    if (rowOnly) {
      await this.admin.call('POST', '/api/save_row', { table: 'Permission', row: { ref_table: PLANT, role, can_read: true, own_rows_only: true } }, [201], 'own-row grant');
      await acceptanceSql('update tasker.homeplant set created_by = $1 where row_id = $2', [this.user, 'south']);
    }
    await acceptanceSql('delete from featherbase.has_role where parent = $1', [this.user]);
    await acceptanceSql("insert into featherbase.has_role (row_id,parent,parenttype,parentfield,role) values ($1,$2,'Person','roles',$3)", [role, this.user, role]);
  }
  async failValidation(history = false) {
    if (history) await this.page.route('**/api/events/summary', route => route.abort());
    await this.page.route('**/api/home_resume', async route => {
      await expect(this.tile()).toHaveCount(0);
      await route.abort();
    });
    await this.page.goto('/featherbase/admin');
    await expect(this.tile()).toHaveCount(0);
  }
}
module.exports = { HomeDestinations, PLANT, DEPOT };
