'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Api } = require('../api');
const { restartAcceptance, acceptanceSql } = require('../stack');

class AppNavigation {
  constructor(page) { this.page = page; }
  static async install(api) {
    const res = await api.call('GET', '/api/apps', undefined, [200], 'installed apps');
    const { installed } = await res.json();
    for (const name of ['tasker', 'feather_dash'])
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
    // Satisfy the app's declared host secret without a real warehouse token;
    // navigation reads the local cached dataset configured below.
    await restartAcceptance({ MOTHERDUCK_TOKEN: 'acceptance-unused-warehouse-token' });
    const systems = JSON.parse(readFileSync(path.resolve(__dirname, '../../../apps/server/seeds/jeyarama/identifier-systems.json')));
    await api.saveRow('Identifier System', { ...systems.identifier_systems.find(system => system.row_id === 'stylehr-employee-code'), enabled: true });
    // The shipped scope provider still declares the legacy chart during its
    // rollout. These empty, scope-marked tables are instance configuration.
    for (const [name, columns] of [
      ['Sales Target Assignment', ['employee', 'plant_code', 'store_label', 'material_group']],
      ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name']],
      ['Section Ownership', ['store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from']],
      ['Store Manager', ['store_code', 'employee_code', 'full_name', 'email']],
      ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
      ['Section Name Alias', ['store_code', 'merch_section_name', 'roster_section_name']],
    ])
      await api.call('POST', '/api/table_def', { name, module: 'Store Sections', decides_scope: true,
        columns: columns.map(column_name => ({ column_name, column_type: 'Data' })) }, [201], `configure ${name}`);
    const fields = encodeURIComponent(JSON.stringify(['row_id']));
    const filters = encodeURIComponent(JSON.stringify([['email', '=', email]]));
    const res = await api.call('GET', `/api/table/Person?fields=${fields}&filters=${filters}`, undefined, [200], 'find reader');
    const { data } = await res.json();
    const dash = await AppNavigation.appApi(api, 'feather_dash');
    for (const store of ['9901', '9902']) {
      await dash.saveRow('feather_dash.store_rollout', { store, live_since: '2026-01-01' });
      await dash.saveRow('feather_dash.job_assignment', { person: data[0].row_id, job: 'Store Manager', store, starts_on: '2026-01-01' });
    }
    await api.saveRow('Data Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'FEATHER_DASH_LOCAL_DUCKDB', access: 'read_only' });
    // An existing cached month supplies the store's human name. No warehouse
    // connection or intercepted report response is needed for navigation.
    const { datasets } = JSON.parse(readFileSync(path.resolve(__dirname, '../../../client-apps/jeyarama/dash/featherbase.json')));
    const dataset = datasets.find(entry => entry.name === 'sales_month');
    const version = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16);
    const id = randomUUID();
    await acceptanceSql(`insert into featherbase.dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
      values ($1, 'feather_dash.sales_month', $2, 'active', now(), now(), 2)`, [id, version]);
    for (const [store_code, store_name] of [['9901', 'Hill Road'], ['9902', 'Lakeside']])
      await acceptanceSql('insert into featherbase.app_dataset_row (snapshot_id, row) values ($1, $2::jsonb)', [id, { store_code, store_name }]);
  }
  async tasker() { await this.page.goto('/tasker/'); }
  async dash() { await this.page.goto('/feather_dash/'); }
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
    const options = await this.choices().locator('option').allTextContents();
    assert.deepEqual(options.sort(), ['Feather Dash', 'Tasker']);
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
    await this.page.goto('/feather_dash/?store=9902');
    const response = await this.page.request.get('/api/app_bar/feather_dash');
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual((await response.json()).controls[0]?.options, [{ label: 'Hill Road', value: '9901' }, { label: 'Lakeside', value: '9902' }]);
    await this.page.getByRole('combobox', { name: 'Store', exact: true }).filter({ hasText: 'Lakeside' }).waitFor();
  }
  async openReport() { await this.sidebar().getByRole('link', { name: 'Sales report' }).click(); }
  async expectStore() {
    await this.page.getByRole('combobox', { name: 'Store', exact: true }).filter({ hasText: 'Lakeside' }).waitFor();
    assert.equal(new URL(this.page.url()).searchParams.get('store'), '9902');
  }
  async expectReport() {
    await this.page.locator('[data-testid="feather-dash"]:not([data-view="opening"])').waitFor();
    assert.notEqual(await this.page.getByTestId('feather-dash').getAttribute('data-view'), 'no_access');
    await this.expectStore();
  }
}

module.exports = { AppNavigation };
