'use strict';

const assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { FormPage } = require('./form-page');
const { ListPage } = require('./list-page');
const { ImportWizardPage } = require('./import-wizard-page');
const { acceptanceSql, restartAcceptance } = require('../stack');

// Literal expected addresses are deliberately independent of the application's
// URL builders. Only row/query values are encoded here, never Table names.
const ROOT = '/featherbase/admin/table/route-probe';
const STOCK = '/featherbase/admin/table/route-probe/row/Stock%20review';
const IDS = ['columns', 'merge', 'new', 'A / B?x#%'];
const PATHS = [
  '/featherbase/admin/table/route-probe/row/columns',
  '/featherbase/admin/table/route-probe/row/merge',
  '/featherbase/admin/table/route-probe/row/new',
  '/featherbase/admin/table/route-probe/row/A%20%2F%20B%3Fx%23%25',
];
const FILTERS = [['subject', '=', 'Stock review']];
const PREFILL = { subject: 'A / B?x#%', notes: 'Route Probe unchanged' };

function queryValue(url, key) {
  const raw = new URL(url).searchParams.get(key);
  assert.notEqual(raw, null, `missing ${key} query parameter`);
  const value = JSON.parse(raw);
  // Pasted URLs contain JSON directly; TanStack-generated URLs quote a
  // JSON-looking string once more to preserve its string type on parsing.
  return typeof value === 'string' ? JSON.parse(value) : value;
}

class TableAddresses {
  constructor(page) {
    this.page = page;
    this.form = new FormPage(page);
    this.list = new ListPage(page);
  }

  static async arrange(api, name = 'Route Probe', ids = ['Stock review', 'Unselected review']) {
    // Print Format references block table deletion on the next scenario.
    const formats = await api.call('GET', '/api/table/Print%20Format?filters=' +
      encodeURIComponent(JSON.stringify([['ref_table', '=', name]])), undefined, [200], 'find probe formats');
    for (const row of (await formats.json()).data)
      await api.call('DELETE', `/api/table/Print%20Format/${encodeURIComponent(row.row_id)}`, undefined, [200], 'remove probe format');
    await api.createTable({ name, module: 'Route acceptance', id_pattern: 'field:subject', title_column: 'subject',
      columns: [
        { column_name: 'subject', column_type: 'Data', label: 'Review title', reqd: true, in_list_view: true },
        { column_name: 'notes', column_type: 'Data', label: 'Review notes', in_list_view: true },
      ] }, ids.map(subject => ({ subject, notes: `Existing ${subject}` })));
  }

  static async editorRole(api) {
    const role = 'Route Probe Editor';
    const existing = await api.call('GET', '/api/table/Role/Route%20Probe%20Editor');
    if (existing.status() !== 200) await api.saveRow('Role', { row_id: role });
    await api.saveRow('Permission', { ref_table: 'Route Probe', role, tier: 'basic',
      can_read: true, can_write: true, can_create: true });
    return role;
  }

  async expectEditor() {
    const response = await this.page.request.get('/api/whoami');
    assert.equal(response.status(), 200, await response.text());
    const session = await response.json();
    assert.notEqual(session.name, 'Administrator');
    assert.ok(!session.roles.includes('System Manager'));
    assert.equal(session.capabilities.manage, false);
    assert.ok(session.capabilities.tables.includes('Route Probe'));
    assert.ok(session.capabilities.creatable.includes('Route Probe'));
    assert.ok(!session.capabilities.creatable.includes('route-probe'));
  }

  async path(expected) { await expect(this.page).toHaveURL(url => url.pathname === expected); }
  async visit(path) { await this.page.goto(path); }
  async stockAddress() { await this.path(STOCK); }
  async stockIdentity(api) { assert.equal((await api.row('Route Probe', 'Stock review')).subject, 'Stock review'); }
  async openAmbiguous() { await this.visit('/featherbase/admin/table/legacy-route-probe'); }
  async formReady() { await expect(this.page.getByTestId('form-view')).toBeVisible(); }
  async save() {
    const saved = this.page.waitForResponse(r => r.url().endsWith('/api/save_row') && r.request().method() === 'POST');
    await this.page.getByTestId('form-save').click();
    const response = await saved;
    assert.equal(response.status(), 201, await response.text());
    assert.equal(response.request().postDataJSON().table, 'Route Probe');
    await expect(this.page.getByTestId('form-status')).toHaveText('Saved');
    return response.request().postDataJSON().row;
  }
  async navigate(name) {
    await this.visit('/featherbase/admin/all-tables');
    await this.page.getByTestId('table-nav').getByRole('link', { name, exact: true }).click();
  }
  async editStock() {
    await this.expectEditor();
    await this.navigate('Route Probe');
    await this.path(ROOT);
    // A raw URL slug used to gate canonical capability arrays hides this.
    await expect(this.page.getByTestId('list-new')).toHaveAttribute('href', ROOT + '/new');
    await this.page.getByTestId('list-rows').getByRole('link', { name: 'Stock review', exact: true }).click();
    await this.path(STOCK);
    await this.formReady();
    assert.equal(await this.form.showsField('Review title'), true);
    await this.page.getByLabel('Review notes', { exact: true }).fill('Reviewed through readable address');
    const saved = await this.save();
    assert.equal(saved.row_id, 'Stock review');
    assert.equal(saved.subject, 'Stock review');
    assert.equal(saved.notes, 'Reviewed through readable address');
  }
  async originalIdentity(api) {
    const row = await api.row('Route Probe', 'Stock review');
    assert.equal(row.row_id, 'Stock review');
    assert.equal(row.subject, 'Stock review');
    assert.equal(row.notes, 'Reviewed through readable address');
    await expect(this.page.getByTestId('breadcrumbs').getByRole('link', { name: 'Route Probe', exact: true })).toHaveAttribute('href', ROOT);
    await expect(this.page.getByRole('heading', { name: 'Route Probe: Stock review', exact: true })).toBeVisible();
    assert.equal(await this.form.showsField('Review title'), true);
    const meta = await api.call('GET', '/api/table/route-probe:meta', undefined, [200], 'canonical metadata');
    const metadata = await meta.json();
    assert.equal(metadata.name, 'Route Probe');
    assert.equal(metadata.columns.find(column => column.column_name === 'subject').label, 'Review title');
    await this.page.reload();
    await expect(this.page.getByLabel('Review notes', { exact: true })).toHaveValue('Reviewed through readable address');
  }
  async reservedTable() {
    await this.path('/featherbase/admin/table/new-table');
    await expect(this.page.getByTestId('list-view')).toBeVisible();
    await expect(this.page.getByTestId('list-rows')).toContainText('Stock review');
    await expect(this.page.getByTestId('table-builder')).toHaveCount(0);
    await this.page.reload();
    await expect(this.page.getByTestId('list-view')).toBeVisible();
  }
  async reservedRows() {
    for (let index = 0; index < IDS.length; index++) {
      await this.visit(PATHS[index]);
      await this.formReady();
      await this.path(PATHS[index]);
      await expect(this.page.getByTestId('form-status')).toHaveText('Saved');
      await expect(this.page.getByLabel('Review title', { exact: true })).toHaveValue(IDS[index]);
      await expect(this.page.getByLabel('Review notes', { exact: true })).toHaveValue(`Existing ${IDS[index]}`);
      await this.page.getByLabel('Review notes', { exact: true }).fill(`Edited ${IDS[index]}`);
      assert.equal((await this.save()).row_id, IDS[index]);
    }
  }
  async exactRows(api) {
    for (const id of IDS) {
      const row = await api.row('Route Probe', id);
      assert.equal(row.row_id, id);
      assert.equal(row.notes, `Edited ${id}`);
    }
  }
  async contextDestinations(api) {
    await this.visit(ROOT + '?filters=' + encodeURIComponent(JSON.stringify(FILTERS)));
    await expect(this.page.getByTestId('list-rows')).toContainText('Stock review');
    assert.deepEqual(queryValue(this.page.url(), 'filters'), FILTERS);
    assert.equal((await this.list.rowTexts()).length, 1);
    // Generated links, not just successful direct loads.
    await expect(this.page.getByTestId('list-new')).toHaveAttribute('href', ROOT + '/new');
    await this.page.getByRole('button', { name: 'Table administration', exact: true }).click();
    for (const [control, path] of [
      ['open-columns', ROOT + '/columns'],
      ['open-merge', ROOT + '/merge'], ['open-naming', ROOT + '/naming'],
      ['open-permissions', ROOT + '/permissions'],
    ]) await expect(this.page.getByTestId(control)).toHaveAttribute('href', path);
    await this.page.keyboard.press('Escape');
    await this.page.getByRole('button', { name: 'View: List', exact: true }).click();
    await expect(this.page.getByTestId('open-report')).toHaveAttribute('href', ROOT + '/view/report');

    await this.visit(ROOT + '/new?prefill=' + encodeURIComponent(JSON.stringify(PREFILL)));
    await this.formReady();
    assert.deepEqual(queryValue(this.page.url(), 'prefill'), PREFILL);
    await expect(this.page.getByLabel('Review title', { exact: true })).toHaveValue(PREFILL.subject);
    await expect(this.page.getByLabel('Review notes', { exact: true })).toHaveValue(PREFILL.notes);
    await expect(this.page.getByTestId('form-status')).toHaveText('Not saved');
    await this.save();
    await this.path('/featherbase/admin/table/route-probe/row/A%20%2F%20B%3Fx%23%25');
    assert.equal((await api.row('Route Probe', PREFILL.subject)).notes, PREFILL.notes);

    await api.saveRow('Print Format', { row_id: 'Route Probe print', ref_table: 'Route Probe', is_default: true,
      template: '<p>Canonical review: {{ subject }}</p>' });
    await this.visit(STOCK);
    await this.formReady();
    await this.page.getByRole('button', { name: 'Record actions', exact: true }).click();
    await expect(this.page.getByTestId('form-print')).toHaveAttribute('href', '/featherbase/print/route-probe/Stock%20review');
    await expect(this.page.getByTestId('form-map')).toHaveAttribute('href', STOCK + '/map');
    await this.page.getByTestId('form-print').click();
    await expect(this.page.getByTestId('print-format-body')).toHaveText('Canonical review: Stock review');
    await expect(this.page.getByTestId('print-docname')).toContainText('Stock review');
    await this.visit('/featherbase/portal/route-probe');
    await expect(this.page.getByTestId('portal-title')).toHaveText('My Route Probe');
    await expect(this.page.getByTestId('portal-row').getByRole('link', { name: 'Stock review', exact: true }))
      .toHaveAttribute('href', '/featherbase/portal/route-probe/Stock%20review');
    await this.page.getByTestId('portal-row').getByRole('link', { name: 'Stock review', exact: true }).click();
    await expect(this.page.getByTestId('portal-doc')).toContainText('Stock review');
    await expect(this.page.getByTestId('portal-field-subject')).toHaveText('Stock review');
    await this.visit(STOCK + '/map');
    await expect(this.page.getByTestId('relation-map')).toBeVisible();
    await expect(this.page.getByTestId('map-open-form')).toHaveAttribute('href', STOCK);
    await this.visit(ROOT + '/view/report');
    await expect(this.page.getByTestId('report-view')).toBeVisible();
    await expect(this.page.getByTestId('report-to-list')).toHaveAttribute('href', ROOT);
    await this.visit(ROOT + '/permissions');
    await expect(this.page.getByTestId('permission-manager')).toContainText('Route Probe');
    await expect(this.page.getByTestId('perm-Route Probe Reader-can_read')).toBeChecked();
    await expect(this.page.getByTestId('perm-Route Probe Reader-can_write')).not.toBeChecked();
  }
  async settings() {
    const read = this.page.waitForResponse(r => decodeURIComponent(new URL(r.url()).pathname) === '/api/table/System Settings/System Settings');
    await this.visit('/featherbase/admin/table/system-settings');
    await this.formReady();
    assert.equal((await read).status(), 200);
    await expect(this.page.getByTestId('breadcrumbs')).toContainText('System Settings');
    await expect(this.page.getByTestId('form-status')).toHaveText('Saved');
    await expect(this.page.getByRole('heading', { name: /System Settings:/ })).toBeVisible();
  }
  async refuseSlugTwin(api) {
    this.originalMetadata = await (await api.call('GET', '/api/table/route-probe:meta', undefined, [200])).json();
    this.originalRow = await api.row('Route Probe', 'Stock review');
    this.refusal = await api.call('POST', '/api/table_def', {
      name: 'Route Probe ', columns: [{ column_name: 'subject', column_type: 'Data' }],
    });
  }
  async unchangedAfterRefusal(api) {
    assert.equal(this.refusal.status(), 409, await this.refusal.text());
    assert.match(await this.refusal.text(), /Route Probe/);
    const metadata = await (await api.call('GET', '/api/table/route-probe:meta', undefined, [200])).json();
    assert.deepEqual(metadata, this.originalMetadata);
    assert.deepEqual(await api.row('Route Probe', 'Stock review'), this.originalRow);
    const rows = await api.call('GET', '/api/table/route-probe', undefined, [200]);
    assert.equal((await rows.json()).total, 2);
  }
  async originalReachable() {
    await this.navigate('Route Probe');
    await this.path(ROOT);
    await this.page.getByTestId('list-rows').getByRole('link', { name: 'Stock review', exact: true }).click();
    await this.path(STOCK);
    await this.formReady();
    await expect(this.page.getByLabel('Review title', { exact: true })).toHaveValue('Stock review');
    await expect(this.page.getByLabel('Review notes', { exact: true })).toHaveValue('Existing Stock review');
    await this.page.reload();
    await expect(this.page.getByLabel('Review notes', { exact: true })).toHaveValue('Existing Stock review');
  }
  async importSlugTwin(api) {
    this.originalMetadata = await (await api.call('GET', '/api/table/route-probe:meta', undefined, [200])).json();
    this.originalRow = await api.row('Route Probe', 'Stock review');
    const wizard = new ImportWizardPage(this.page);
    await wizard.open();
    await wizard.dropCsv('route-probe.csv', 'subject,notes\nIncoming,Must not land\n');
    await wizard.asNewTable('Route Probe ');
    const response = this.page.waitForResponse(r => new URL(r.url()).pathname === '/api/table_def' && r.request().method() === 'POST');
    await this.page.getByTestId('iw-import').click();
    this.refusal = await response;
    assert.equal(this.refusal.request().postDataJSON().name, 'Route Probe ');
  }
  async importRefused(api) {
    await this.unchangedAfterRefusal(api);
    await expect(this.page.getByTestId('iw-failure-0')).toContainText('Route Probe');
    await expect(this.page.getByTestId('iw-result-0')).toHaveCount(0);
    await expect(this.page.getByTestId('list-view')).toHaveCount(0);
  }
  async importOther(api) {
    await api.removeTableIfPresent('Route Import Other');
    const wizard = new ImportWizardPage(this.page);
    await wizard.open();
    await wizard.dropCsv('route-other.csv', 'subject,notes\nIncoming,Allowed import\n');
    await wizard.asNewTable('Route Import Other');
    await wizard.importAll();
    await this.path('/featherbase/admin/table/route-import-other');
    await expect(this.page.getByTestId('list-rows')).toContainText('Incoming');
    const rows = await api.call('GET', '/api/table/route-import-other', undefined, [200]);
    const imported = (await rows.json()).data;
    assert.equal(imported.length, 1);
    assert.equal((await api.row('Route Import Other', imported[0].row_id)).notes, 'Allowed import');
  }
  static async ambiguousDefinitions(api) {
    await TableAddresses.arrange(api, 'Legacy Route Probe');
    // Hyphenated plain names are not legal for new Tables. Reproduce two
    // pre-existing legacy definitions, then clear the API's metadata cache.
    await acceptanceSql("insert into featherbase.table_def (name, module, custom) values ('Legacy-Route-Probe', 'Route acceptance', true)");
    await restartAcceptance();
  }
  async ambiguity(api) {
    try {
      const response = await api.call('GET', '/api/table/legacy-route-probe:meta');
      assert.equal(response.status(), 409, await response.text());
      assert.match(await response.text(), /ambiguous/i);
      for (const name of ['Legacy Route Probe', 'Legacy-Route-Probe']) {
        const exact = await api.call('GET', `/api/table/${encodeURIComponent(name)}:meta`, undefined, [200], 'exact name wins');
        assert.equal((await exact.json()).name, name);
      }
      await expect(this.page.getByText(/ambiguous/i).first()).toBeVisible();
      await expect(this.page.getByTestId('list-view')).toHaveCount(0);
      await expect(this.page.getByTestId('form-view')).toHaveCount(0);
      await this.visit('/featherbase/admin/table/Legacy%20Route%20Probe');
      await expect(this.page.getByTestId('list-rows')).toContainText('Stock review');
    } finally {
      // This metadata-only legacy fixture has no backing relation. Do not
      // let it poison later scenarios that search all readable Tables.
      await acceptanceSql("delete from featherbase.table_def where name = 'Legacy-Route-Probe'");
      await restartAcceptance();
    }
  }
}

module.exports = { TableAddresses, IDS };
