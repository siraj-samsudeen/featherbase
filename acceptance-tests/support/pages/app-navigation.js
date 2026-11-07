'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Api } = require('../api');
const { restartAcceptance } = require('../stack');

class AppNavigation {
  constructor(page) { this.page = page; }
  static async install(api) {
    const res = await api.call('GET', '/api/apps', undefined, [200], 'installed apps');
    const { installed } = await res.json();
    for (const name of ['tasker', 'dash'])
      if (!installed.some(app => app.name === name))
        await api.call('POST', '/api/apps/prepare-install', { name }, [201], `prepare and install ${name}`);
    await api.admitTaskerAdministrator();
  }
  static async appApi(api, name) {
    const res = await api.call('GET', '/api/apps', undefined, [200], 'installed versions');
    const { installed } = await res.json();
    return new Api(api.ctx, { ...api.headers, 'X-Featherbase-App-Version': `${name}@${installed.find(app => app.name === name).version}` });
  }
  static async project(api) {
    const tasker = await AppNavigation.appApi(api, 'tasker');
    const project = await tasker.saveRow('tasker.project', { project_name: 'September stock review' });
    for (const task_title of ['Count the blue shirts', 'Review the missing sizes'])
      await tasker.saveRow('tasker.task', { task_title, project: project.row_id });
  }
  static async store(api, email) {
    // Satisfy the app's declared host secret without a real warehouse token.
    await restartAcceptance({ MOTHERDUCK_TOKEN: 'acceptance-unused-warehouse-token' });
    // Dash reads a reader's reach from the instance's core Tables: the same
    // ones its own platform tests create.
    const { ACCESS_ROWS, BASE_TABLES, LINKED_TABLES, REPORT_ROWS } = await import(pathToFileURL(path.resolve(__dirname, '../../../client-apps/jeyarama/dash/platform-test/base-tables.mjs')).href);
    // Scenarios share the database's Tables (their rows are cleared), so a Table may already exist.
    for (const table of BASE_TABLES) await api.call('POST', '/api/table_def', table, [201, 409], `configure ${table.name}`);
    await api.call('POST', '/api/instance-settings/apply', { file: { settings: { 'App Setting': [{ row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES) }] } } }, [200], 'list the core Tables Dash reads');
    const dash = await AppNavigation.appApi(api, 'dash');
    // Rows survive between scenarios too: make the stores and reports only once.
    const sites = encodeURIComponent(JSON.stringify([['code', '=', 'HIL']]));
    const made = (await (await api.call('GET', `/api/table/Site?filters=${sites}`, undefined, [200], 'look for the store')).json()).data.length > 0;
    if (!made) {
      for (const [plant_code, code, name] of [['9901', 'HIL', 'Hill Road'], ['9902', 'LKS', 'Lakeside']]) {
        await api.saveRow('Site', { code, name, is_store: true });
        await api.saveRow('Plant', { plant_code, plant_type: 'Store', site: code });
      }
      for (const row of REPORT_ROWS) await dash.saveRow('dash.report', row);
      // #1046: a report opens only for someone it is given to; these give each to Dash Reader.
      for (const row of ACCESS_ROWS) await dash.saveRow('dash.report_access', row);
    }
    const fields = encodeURIComponent(JSON.stringify(['row_id']));
    const filters = encodeURIComponent(JSON.stringify([['email', '=', email]]));
    const res = await api.call('GET', `/api/table/Person?fields=${fields}&filters=${filters}`, undefined, [200], 'find reader');
    const { data } = await res.json();
    const employee = `E-${data[0].row_id}`;
    await api.saveRow('Employee', { employee_code: employee, name: 'Made-up Manager', person: data[0].row_id, status: 'Current' });
    for (const code of ['HIL', 'LKS'])
      await api.saveRow('Job Assignment', { assignment_id: `JA-${employee}-${code}`, employee, job: 'Store Manager', site: code, starts_on: '2026-01-01' });
  }
  async tasker() { await this.page.goto('/tasker/'); }
  async dash() { await this.page.goto('/dash/'); }
  choices() { return this.page.getByRole('combobox', { name: 'Switch application' }); }
  sidebar() { return this.page.locator('featherbase-sidebar'); }
  async chooseBase() {
    await this.tasker();
    await this.choices().selectOption('/featherbase/admin');
  }
  async expectBase() { await this.page.getByTestId('admin-sidebar').waitFor(); }
  async expectNoSeparateAdmin() {
    await this.tasker();
    assert.equal(await this.page.getByTestId('open-admin').count(), 0);
    assert.equal(await this.sidebar().getByRole('link', { name: /Featherbase|Admin/ }).count(), 0);
  }
  async expectAppsOnly() {
    await this.page.getByTestId('session-user').waitFor();
    // The switcher holds only the current app until the catalog answers.
    await this.choices().locator('option', { hasText: 'Tasker' }).waitFor({ state: 'attached' });
    const options = await this.choices().locator('option').allTextContents();
    assert.deepEqual(options.sort(), ['Dash', 'Tasker']);
  }
  async expectNoBase() {
    assert.equal(await this.choices().locator('option[value="/featherbase/admin"]').count(), 0);
  }
  async openProject() {
    await this.tasker();
    await this.sidebar().getByRole('button', { name: 'September stock review', exact: true }).click();
  }
  async expectTasks() {
    for (const name of ['Count the blue shirts', 'Review the missing sizes'])
      await this.page.getByRole('link', { name, exact: true }).waitFor();
  }
  async expectProjectCurrent() {
    assert.equal(await this.sidebar().getByRole('button', { name: 'September stock review', exact: true }).getAttribute('aria-current'), 'page');
  }
  async selectStore() {
    await this.page.goto('/dash/?store=9902');
    const response = await this.page.request.get('/api/app_bar/dash');
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual((await response.json()).controls[0]?.options, [{ label: 'Hill Road', value: '9901' }, { label: 'Lakeside', value: '9902' }]);
    await this.page.getByRole('combobox', { name: 'Store', exact: true }).filter({ hasText: 'Lakeside' }).waitFor();
  }
  async openReport() { await this.sidebar().getByRole('link', { name: 'Sales versus target' }).click(); }
  async expectStore() {
    await this.page.getByRole('combobox', { name: 'Store', exact: true }).filter({ hasText: 'Lakeside' }).waitFor();
    assert.equal(new URL(this.page.url()).searchParams.get('store'), '9902');
  }
  async expectReport() {
    await this.page.locator('[data-testid="dash"]:not([data-view="opening"])').waitFor();
    assert.notEqual(await this.page.getByTestId('dash').getAttribute('data-view'), 'no_access');
    await this.expectStore();
  }
}

module.exports = { AppNavigation };
