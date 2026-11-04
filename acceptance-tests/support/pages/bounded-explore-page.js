'use strict';

const assert = require('node:assert/strict');
const { AfterAll } = require('@cucumber/cucumber');
const { externalSql, isolatedEnvironment, restartAcceptance } = require('../stack');

let connectedInstalled = false;
const schemas = new Set();

class BoundedExplorePage {
  constructor(page, connected = false) {
    this.page = page;
    this.connected = connected;
    const prefix = connected ? 'Bounded Connected ' : 'Bounded Native ';
    this.tables = ['Section', 'FloorSection', 'AssignmentSection', 'Assignment', 'Worker'].map(t => prefix + t);
  }

  async install(api) {
    const [section, floor, junction, assignment, worker] = this.tables;
    const definitions = [
      [section, 'section', []],
      [worker, 'worker', []],
      [assignment, 'assignment', [['worker', worker]]],
      [floor, 'floor_section', [['section', section]]],
      [junction, 'assignment_section', [['floor_section', floor], ['assignment', assignment]]],
    ];
    if (this.connected && !connectedInstalled) {
      // The acceptance harness owns this disposable sibling, never the platform DB.
      await externalSql(`create schema if not exists bounded_781;
        create table bounded_781.section (code text primary key, label text);
        create table bounded_781.worker (code text primary key, label text);
        create table bounded_781.assignment (code text primary key, label text, worker text);
        create table bounded_781.floor_section (code text primary key, label text, section text);
        create table bounded_781.assignment_section (code text primary key, label text, floor_section text, assignment text);
        insert into bounded_781.section values ('north','North'),('south','South');
        insert into bounded_781.worker values ('w-a','Invented Amber'),('w-b','Invented Birch'),('w-c','Invented Cedar'),('w-x','Unreachable Control');
        insert into bounded_781.assignment values ('a-a','Assignment A','w-a'),('a-b','Assignment B','w-b'),('a-c','Assignment C','w-c'),('a-x','Unlinked Assignment','w-x');
        insert into bounded_781.floor_section select 'f-' || lpad(n::text,3,'0'), 'Floor ' || n, case when n = 121 then 'south' else 'north' end from generate_series(1,121) n;
        insert into bounded_781.assignment_section select 'j-' || lpad(n::text,3,'0'), 'Junction ' || n, 'f-' || lpad(n::text,3,'0'), case when n = 121 then 'a-c' when n = 2 then 'a-b' else 'a-a' end from generate_series(1,121) n;`);
      schemas.add('bounded_781');
      const url = new URL(isolatedEnvironment().DATABASE_URL);
      url.pathname += '_ext';
      await restartAcceptance({ ISSUE781_ACCEPTANCE_SOURCE_URL: url.toString() });
      await api.call('POST', '/api/table/Data%20Source', {
        row_id: 'bounded-781', engine: 'postgres', access: 'read_only', url_env: 'ISSUE781_ACCEPTANCE_SOURCE_URL',
      }, [201]);
      connectedInstalled = true;
    }
    const existing = await api.call('GET', `/api/table/${encodeURIComponent(section)}:meta`, undefined, [200, 404]);
    if (existing.status() === 200) return;
    for (const [name, relation, references] of definitions) {
      await api.call('POST', '/api/table_def', {
        name, title_column: 'label', id_pattern: 'prompt',
        ...(this.connected ? { data_source: 'bounded-781', external_schema: 'bounded_781', external_table: relation, external_pk: 'code' } : {}),
        columns: [{ column_name: 'label', column_type: 'Data', in_list_view: true },
          ...references.map(([column_name, reference_table]) => ({ column_name, column_type: 'Reference', reference_table }))],
      }, [200, 201]);
    }
    if (this.connected) return;
    for (const [table, rows] of [
      [section, [{ row_id: 'north', label: 'North' }, { row_id: 'south', label: 'South' }]],
      [worker, [{ row_id: 'w-a', label: 'Invented Amber' }, { row_id: 'w-b', label: 'Invented Birch' }, { row_id: 'w-c', label: 'Invented Cedar' }, { row_id: 'w-x', label: 'Unreachable Control' }]],
      [assignment, ['a', 'b', 'c', 'x'].map(id => ({ row_id: `a-${id}`, label: `Assignment ${id}`, worker: `w-${id}` }))],
      [floor, [{ row_id: 'f-n', label: 'North floor', section: 'north' }, { row_id: 'f-s', label: 'South floor', section: 'south' }]],
      [junction, [['j-1', 'f-n', 'a-a'], ['j-2', 'f-n', 'a-a'], ['j-3', 'f-n', 'a-b'], ['j-4', 'f-s', 'a-c']].map(([row_id, floor_section, assignment]) => ({ row_id, label: row_id, floor_section, assignment }))],
    ]) for (const row of rows) await api.call('POST', '/api/save_row', { table, row }, [200, 201]);
  }

  async open() {
    await this.page.goto('/featherbase/admin/explore');
    await this.page.getByTestId('explore-root').selectOption(this.tables[0]);
    const keys = [
      `backlink:${this.tables[1]}:section`, `backlink:${this.tables[2]}:floor_section`,
      `reference:${this.tables[3]}:assignment`, `reference:${this.tables[4]}:worker`,
    ];
    for (let i = 0; i < keys.length; i++)
      await this.page.getByTestId(`explore-step${i + 2}`).selectOption(keys[i]);
  }

  async expectWorkers(labels = ['Invented Amber', 'Invented Birch', 'Invented Cedar']) {
    const pane = this.page.getByTestId('explore-pane5');
    await pane.getByTestId('explore-pane5-count').filter({ hasText: new RegExp(`^${labels.length}$`) }).waitFor();
    const titles = await Promise.all((await pane.getByTestId('explore-row').all()).map(row => row.locator('span').first().textContent()));
    assert.deepEqual(titles.sort(), [...labels].sort());
    assert.equal(await pane.getByText('Unreachable Control').count(), 0);
  }

  async expectBounded() { assert.equal(await this.page.getByTestId('explore-step6').count(), 0); }

  async narrowThenRelease() {
    await this.open();
    await this.page.getByTestId('explore-pane1').getByTestId('explore-row').filter({ has: this.page.getByText('North', { exact: true }) }).click();
    await this.expectWorkers(['Invented Amber', 'Invented Birch']);
    // Select an intermediate row before releasing North: its chip must clear too.
    const row = this.page.getByTestId('explore-pane4').getByTestId('explore-row').first();
    await row.click();
    await this.page.getByRole('button', { name: 'Release north', exact: true }).click();
    await this.expectWorkers();
    assert.equal(await this.page.getByTestId('explore-chip').count(), 0);
  }

  async expectPeekPreservesJourney() {
    const before = this.page.url();
    await this.page.getByTestId('explore-pane5').getByTestId('explore-row').first().click();
    const panel = this.page.getByTestId('peek-panel-0');
    await panel.waitFor();
    await panel.getByTestId('peek-close').click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(this.page.url(), before);
    await this.expectWorkers();
  }

  async expectUnreadable(api) {
    // Explicit denied Table; selecting an upstream ID cannot bypass it.
    const role = 'Bounded 781 endpoint reader';
    await api.call('POST', '/api/save_row', { table: 'Role', row: { row_id: role } }, [200, 201]);
    await api.call('POST', '/api/save_row', { table: 'Permission', row: { ref_table: this.tables[4], role, can_read: true } }, [200, 201]);
    const email = 'bounded-781-denied@example.com';
    const password = 'invented-781-reader-pass';
    await api.createPerson(email, password, [role]);
    const { request } = require('playwright');
    const { API_URL } = require('../stack');
    const client = await request.newContext({ baseURL: API_URL });
    try {
      const login = await client.post('/api/login', { data: { usr: email, pwd: password } });
      assert.equal(login.status(), 200);
      const { token } = await login.json();
      const filters = [['row_id', 'related', { table: this.tables[3], reference: 'worker', filters: [['row_id', 'in', ['a-a']]] }]];
      const result = await client.get(`/api/table/${encodeURIComponent(this.tables[4])}?${new URLSearchParams({ filters: JSON.stringify(filters) })}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(result.status(), 403);
    } finally { await client.dispose(); }
  }
}

AfterAll(async function () {
  for (const schema of schemas) await externalSql(`drop schema ${schema} cascade`);
});

module.exports = { BoundedExplorePage };
