'use strict';

const assert = require('node:assert/strict');
const { PROTOTYPE_URL, BASE_URL } = require('../stack');

class PrototypeLibrary {
  constructor(page) { this.page = page; }

  async open() {
    await this.page.request.post(`${PROTOTYPE_URL}/__lab/scenario`, { data: { scenario: 'populated' } });
    await this.page.goto(`${PROTOTYPE_URL}/prototype.html`);
    await this.page.getByRole('heading', { name: 'Build with what exists' }).waitFor();
  }

  async searchExamples(query) {
    await this.page.getByRole('tab', { name: 'Component gallery', exact: true }).click();
    await this.page.getByRole('searchbox', { name: 'Search components', exact: true }).fill(query);
  }

  async expectMatchingExamples() {
    await this.page.getByRole('heading', { name: 'List (a table when wide, cards on a phone)', exact: true }).waitFor();
    assert.equal(await this.page.getByText('apps/web/src/components/ui/DataList.tsx', { exact: true }).isVisible(), true);
  }

  async expectUnrelatedExcluded() {
    assert.equal(await this.page.getByRole('heading', { name: 'Buttons', exact: true }).count(), 0);
  }

  async searchCollection(query) {
    await this.page.getByRole('textbox', { name: 'Search or type a command', exact: true }).fill('Lab');
    await this.page.getByTestId('awesomebar-table').filter({ hasText: 'Lab Project' }).waitFor();
    assert.equal(await this.page.getByTestId('awesomebar-table').count(), 2);
    assert.equal(await this.page.getByTestId('awesomebar-new').count(), 2);
    await this.page.getByTestId('awesomebar-table').filter({ hasText: 'Lab Project' }).click();
    await this.page.getByRole('searchbox', { name: 'Search Lab Project names', exact: true }).fill(query);
    await this.page.getByTestId('list-rows').getByRole('link', { name: 'lab-north', exact: true }).waitFor();
    this.originalCollection = this.page.url();
    assert.equal(await this.page.getByTestId('list-rows').getByText('South studio', { exact: true }).count(), 0);
  }

  async followRelated() {
    await this.page.getByTestId('list-rows').getByRole('link', { name: 'lab-north', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Name', exact: true }).waitFor();
    await this.page.getByRole('link', { name: 'Related tasks →', exact: true }).click();
    await this.page.getByTestId('list-rows').getByText('Prepare workshop', { exact: true }).waitFor();
    await this.page.getByRole('searchbox', { name: 'Search Lab Task names', exact: true }).waitFor();
  }

  async returnAlongTrail() {
    await this.page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Project', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Name', exact: true }).waitFor();
    await this.page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Lab Project', exact: true }).click();
    await this.page.getByTestId('list-rows').getByText('North workshop', { exact: true }).waitFor();
  }

  async expectSearchRetained() {
    assert.equal(this.page.url(), this.originalCollection);
    assert.equal(await this.page.getByRole('searchbox', { name: 'Search Lab Project names', exact: true }).inputValue(), 'North');
    assert.equal(await this.page.getByTestId('list-rows').getByText('South studio', { exact: true }).count(), 0);
    await this.open();
    await this.page.getByRole('tab', { name: 'Native Table list', exact: true }).click();
    await this.page.getByRole('searchbox', { name: 'Search Lab Project names', exact: true }).fill('South');
    await this.page.getByTestId('list-rows').getByRole('link', { name: 'lab-south', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).waitFor();
    await this.page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Lab Project', exact: true }).click();
    await this.page.getByRole('tabpanel', { name: 'Native Table list', exact: true }).waitFor();
    assert.equal(await this.page.getByRole('searchbox', { name: 'Search Lab Project names', exact: true }).inputValue(), 'South');
    await this.page.getByTestId('list-rows').getByText('South studio', { exact: true }).waitFor();
    assert.equal(await this.page.getByTestId('list-rows').getByText('North workshop', { exact: true }).count(), 0);
  }

  async rowForm() {
    await this.page.goto(`${PROTOTYPE_URL}/featherbase/admin/Lab%20Project/lab-north`);
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).waitFor();
  }

  async editAndReset() {
    await this.rowForm();
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).fill('Edited synthetic region');
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    await this.page.waitForFunction(() => document.querySelector('[data-testid="form-save"]')?.disabled === true);
    await this.page.reload();
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).waitFor();
    assert.equal(await this.page.getByRole('textbox', { name: 'Region', exact: true }).inputValue(), 'Edited synthetic region');
    await this.page.getByRole('button', { name: 'Reset data', exact: true }).click();
  }

  async expectReset() {
    await this.page.waitForFunction(() => document.querySelector('input[data-field="region"]')?.value === 'North');
    await this.open();
    await this.page.getByRole('tab', { name: 'Native Table list', exact: true }).click();
    const scenario = this.page.getByRole('combobox', { name: 'Synthetic scenario', exact: true });
    await scenario.selectOption('empty');
    await this.page.getByTestId('list-rows').getByText('No rows', { exact: false }).waitFor();
    await scenario.selectOption('loading');
    await this.page.getByRole('status').filter({ hasText: 'Loading Lab Project' }).waitFor();
    await scenario.selectOption('error');
    await this.page.getByTestId('list-rows-error').getByText(/Synthetic load failed/).waitFor();
    await scenario.selectOption('permission-limited');
    await this.page.getByTestId('list-rows-error').getByText(/Simulated permission restriction/).waitFor();
    await scenario.selectOption('populated');
    await this.page.getByTestId('list-rows').getByText('South studio', { exact: true }).waitFor();
    await this.page.getByRole('button', { name: 'Reset data', exact: true }).click();
    await this.page.getByTestId('list-rows').getByText('North workshop', { exact: true }).waitFor();
    assert.equal(await this.page.getByRole('tab', { name: 'Native Table list', exact: true }).getAttribute('aria-selected'), 'true');
  }

  async expectSimulationLabel() {
    assert.equal(await this.page.getByText(/Permission scenarios are not security evidence/).isVisible(), true);
  }

  async unsupportedAction() {
    const before = await this.page.request.get(`${PROTOTYPE_URL}/api/table/Lab%20Project/lab-north`);
    this.originalRow = await before.json();
    this.refusal = await this.page.request.delete(`${PROTOTYPE_URL}/api/table/Lab%20Project/lab-north`);
  }

  async expectRefused() {
    assert.equal(this.refusal.status(), 501);
    assert.match((await this.refusal.json()).error.message, /Nothing was forwarded/);
    const after = await this.page.request.get(`${PROTOTYPE_URL}/api/table/Lab%20Project/lab-north`);
    assert.deepEqual(await after.json(), this.originalRow);
    for (const path of ['/api/upload', '/files/private-test', '/private/test', '/ws']) {
      const result = await this.page.request.post(`${PROTOTYPE_URL}${path}`, { data: {} });
      assert.equal(result.status(), 501);
    }
    assert.equal(this.refusal.ok(), false);
  }

  async captureForm() {
    this.syntheticControls = await this.controls();
    // The retained native shell reconciles visits using one acknowledgement per event.
    const before = Date.now();
    const visits = [before - 61_000, before - 19_000, 1, before + 86_400_000];
    const response = await this.page.request.post(`${PROTOTYPE_URL}/api/events`, {
      data: { events: visits.map((at) => ({ kind: 'row', key: 'Lab Project/lab-north', at })) },
    });
    assert.equal(response.status(), 200);
    const { inserted, timestamps } = await response.json();
    const after = Date.now();
    assert.equal(inserted, 4);
    assert.deepEqual(timestamps.slice(0, 2), visits.slice(0, 2));
    assert.ok(timestamps[2] >= before - 604_800_000 && timestamps[2] <= after - 604_800_000);
    assert.ok(timestamps[3] >= before && timestamps[3] <= after);
  }

  async controls() {
    return this.page.getByTestId('form-view').locator('input[data-field], select[data-field]').evaluateAll((controls) => controls.map((control) => ({
      column: control.getAttribute('data-field'),
      tag: control.tagName, type: control.type,
      label: document.getElementById(control.getAttribute('aria-labelledby'))?.textContent,
      rowOffset: Math.round(control.getBoundingClientRect().y - controls[0].getBoundingClientRect().y),
      columnOffset: Math.round(control.getBoundingClientRect().x - controls[0].getBoundingClientRect().x),
      width: Math.round(control.getBoundingClientRect().width),
    })));
  }

  static async prepareReal(api) {
    await api.createTable({ name: 'Lab Project', title_column: 'name', columns: [
      { column_name: 'name', label: 'Name', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'region', label: 'Region', column_type: 'Data', in_list_view: true },
      { column_name: 'enabled', label: 'Enabled', column_type: 'Check', in_list_view: true },
    ] }, [{ row_id: 'lab-north', name: 'North workshop', region: 'North', enabled: true }]);
  }

  async connectReal() {
    await this.page.goto(`${BASE_URL}/featherbase/admin/Lab%20Project/lab-north`);
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).waitFor();
  }

  async expectRetained() {
    assert.deepEqual(this.syntheticControls.map(({ column, tag, type, label }) => ({ column, tag, type, label })), [
      { column: 'name', tag: 'INPUT', type: 'text', label: 'Name' },
      { column: 'region', tag: 'INPUT', type: 'text', label: 'Region' },
      { column: 'enabled', tag: 'INPUT', type: 'checkbox', label: 'Enabled' },
    ]);
    assert.deepEqual(await this.controls(), this.syntheticControls);
  }

  async expectPersistentSave() {
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).fill('Saved on isolated server');
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    await this.page.waitForFunction(() => document.querySelector('[data-testid="form-save"]')?.disabled === true);
    await this.page.reload();
    await this.page.getByRole('textbox', { name: 'Region', exact: true }).waitFor();
    assert.equal(await this.page.getByRole('textbox', { name: 'Region', exact: true }).inputValue(), 'Saved on isolated server');
  }
}

module.exports = { PrototypeLibrary };
