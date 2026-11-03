'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { tableHref, rowHref } = require('../../../packages/shared/src/app-routes.ts');
const { acceptanceSql, REPO_ROOT } = require('../stack');
const { ListPage } = require('./list-page');

const RAW = 'create_if_email_domain_allowed';
const DISPLAY = 'Create only for an allowed email domain';
const UNMAPPED = 'Keep_THIS_authored_text';

// One bounded contact journey; browser details and HTTP paths stay out of steps.
class ReadableLabelsPage {
  constructor(page, api) {
    this.page = page;
    this.api = api;
    this.table = 'Acceptance Readable Contacts';
    this.list = new ListPage(page);
  }

  async defineLabels() {
    await this.api.createTable({ name: this.table, columns: [
      { column_name: 'client_id', column_type: 'Data', in_list_view: true },
      { column_name: 'service_url', column_type: 'Data', label: 'myService URL — keep this sentence', in_list_view: true },
    ] }, [{ client_id: 'contact-826' }]);
  }

  async definePolicy({ translated = false, unmapped = false } = {}) {
    await this.api.createTable({ name: this.table, columns: [
      { column_name: 'policy', label: 'Policy', column_type: 'Choice', choices: `${RAW}\n${UNMAPPED}`,
        choice_labels: { [RAW]: DISPLAY }, in_list_view: true },
    ] });
    this.raw = unmapped ? UNMAPPED : RAW;
    if (translated) {
      await this.api.createPerson('labels-826@example.com', 'acceptance-labels-826', ['System Manager']);
      const found = await this.api.call('GET', `/api/table/Person?filters=${encodeURIComponent(JSON.stringify([['email', '=', 'labels-826@example.com']]))}`,
        undefined, [200], 'find translated reader');
      const { data: [match] } = await found.json();
      const person = await this.api.row('Person', match.row_id);
      await this.api.call('PATCH', `/api/table/Person/${encodeURIComponent(person.row_id)}`,
        { language: 'fr', updated_at: person.updated_at }, [200], 'set contact reader language');
      for (const [source_text, translated_text] of [[RAW, 'Créer SI permis — iD'], [DISPLAY, 'AUTRE traduction']]) {
        await this.api.saveRow('Translation', { row_id: `labels-826-${source_text}`, language: 'fr', source_text, translated_text });
      }
    }
  }

  async openList() { await this.list.open(this.table); }
  async labels() { return this.list.columnLabels(); }

  async openPolicy() {
    const row = await this.api.saveRow(this.table, { policy: this.raw });
    this.rowId = row.row_id;
    await this.page.goto(rowHref(this.table, this.rowId));
    await this.page.getByTestId('form-view').waitFor();
  }

  policyControl() { return this.page.getByTestId('form-view').locator('select[data-field="policy"]'); }
  async optionText() {
    return this.policyControl().locator(`option[value="${this.raw}"]`).textContent();
  }

  async chooseAndSave() {
    await this.page.goto(`${tableHref(this.table)}/new`);
    await this.policyControl().waitFor();
    await this.policyControl().selectOption(RAW);
    const saved = this.page.waitForResponse(r => r.url().includes('/api/save_row') && r.request().method() === 'POST');
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    const res = await saved;
    assert.equal(res.status(), 201, await res.text());
    assert.equal(res.request().postDataJSON().row.policy, RAW, 'save request carries the canonical value');
    this.rowId = (await res.json()).row_id;
    this.raw = RAW;
    await this.api.saveRow(this.table, { policy: UNMAPPED });
  }

  async assertPolicySurfaces() {
    assert.equal(await this.optionText(), DISPLAY, 'form option must use authored wording');
    await this.openList();
    assert.deepEqual((await this.list.columnValues('Policy')).sort(), [DISPLAY, UNMAPPED].sort());
    assert.equal(await this.page.getByTestId('std-filter-policy').locator(`option[value="${RAW}"]`).textContent(), DISPLAY);
  }

  async filterSavedPolicy() {
    const request = this.page.waitForRequest(r => r.url().includes('/api/table/') && new URL(r.url()).searchParams.has('filters'));
    await this.page.getByTestId('std-filter-policy').selectOption(RAW);
    const sent = new URL((await request).url()).searchParams;
    assert.deepEqual(JSON.parse(sent.get('filters')), [['policy', '=', RAW]]);
    assert.equal((await this.api.row(this.table, this.rowId)).policy, RAW);
    const rejected = await this.api.call('POST', '/api/save_row', { table: this.table, row: { policy: DISPLAY } });
    assert.equal(rejected.status(), 417, 'human display text must not become an allowed raw Choice');
    assert.equal((await rejected.json()).error.type, 'ValidationError');
    await this.list.rows().first().waitFor();
    assert.equal(await this.list.rows().count(), 1);
    assert.deepEqual(await this.list.columnValues('Policy'), [DISPLAY]);
  }

  async arrangeUpgrade() {
    this.beforeLabels = await acceptanceSql("select column_name, label from featherbase.column_def where parent = 'Sign In Method' and column_name in ('client_id', 'service_url', 'new_person')");
    await acceptanceSql(`update featherbase.column_def set label = case column_name
      when 'client_id' then 'client_id' when 'service_url' then 'My endpoint wording'
      when 'new_person' then 'new_person' end
      where parent = 'Sign In Method' and column_name in ('client_id', 'service_url', 'new_person')`);
    await this.api.saveRow('Translation', { row_id: 'labels-826-new-person', language: 'fr', source_text: 'new_person', translated_text: 'Politique conservée' });
    await this.api.saveRow('Metadata Override', { row_id: 'labels-826-override', table_name: 'Sign In Method', column_name: 'client_id', property: 'label', value: 'Customer key override' });
    this.beforeOverrides = await acceptanceSql('select * from featherbase.metadata_override order by row_id');
  }

  async applyUpgrade() {
    const migration = readFileSync(path.join(REPO_ROOT, 'apps/server/migrations/0006_readable_labels.sql'), 'utf8');
    await acceptanceSql(`begin; set local search_path = featherbase, public; ${migration}; commit;`);
  }

  async upgradedDefault() {
    const rows = await acceptanceSql("select column_name, label from featherbase.column_def where parent = 'Sign In Method' and column_name in ('client_id', 'new_person') order by column_name");
    assert.deepEqual([...rows], [{ column_name: 'client_id', label: 'Client ID' }, { column_name: 'new_person', label: 'new_person' }]);
  }

  async preservedWording() {
    assert.deepEqual([...(await acceptanceSql("select label from featherbase.column_def where parent = 'Sign In Method' and column_name = 'service_url'"))], [{ label: 'My endpoint wording' }]);
    assert.deepEqual(await acceptanceSql('select * from featherbase.metadata_override order by row_id'), this.beforeOverrides);
    assert.deepEqual([...(await acceptanceSql("select translated_text from featherbase.translation where source_text = 'new_person' and language = 'fr'"))], [{ translated_text: 'Politique conservée' }]);
  }

  async cleanup() {
    await acceptanceSql("delete from featherbase.translation where row_id like 'labels-826-%'");
    await acceptanceSql("delete from featherbase.metadata_override where row_id = 'labels-826-override'");
    for (const { column_name, label } of this.beforeLabels ?? [])
      await acceptanceSql("update featherbase.column_def set label = $1 where parent = 'Sign In Method' and column_name = $2", [label, column_name]);
    await this.api.removeTableIfPresent(this.table);
  }
}

module.exports = { ReadableLabelsPage, RAW, DISPLAY, UNMAPPED };
