'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { changeStandin, acceptanceSql, restartAcceptance, useInstanceToken } = require('./stack');

class CopyRefreshFixture {
  constructor(api) {
    this.api = api;
    this.source = `refresh-${randomUUID().slice(0, 8)}`;
    this.relation = `plants_${randomUUID().replaceAll('-', '')}`;
  }

  async create() {
    await this.api.removeTableIfPresent('Plants');
    changeStandin('sales', [
      `create table ${this.relation} (code varchar, name varchar)`,
      `insert into ${this.relation} values ('P01', 'Rose'), ('P02', 'Fern')`,
    ]);
    await useInstanceToken();
    await this.api.call('POST', '/api/table/Data%20Source:motherduck_connect', {
      name: this.source, databases: ['sales'],
    }, [201], 'connect local plants source');
    await this.api.copyWarehouse(this.source, {
      database: 'sales', schema: 'main', table: this.relation, name: 'Plants', key: 'code',
      columns: [{ source: 'code', column_name: 'code' }, { source: 'name', column_name: 'title' }],
    });
  }

  async schedule(cadence = 'hourly') {
    this.job = await (await this.api.call('POST', '/api/table/Plants:set_copy_schedule', {
      cadence, enabled: true,
    }, [201], 'schedule Plants')).json();
    return this.job;
  }

  async scheduleInfo() {
    return (await this.api.call('GET', '/api/table/Plants:copy_schedule', undefined, [200], 'read schedule')).json();
  }

  async change(statements) {
    changeStandin('sales', statements.map(s => s.replaceAll('$plants', this.relation)));
    // Refresh also discards the stand-in's per-session source snapshot.
    await this.api.refreshWarehouse(this.source, 'sales');
  }

  async correct() {
    const row = await this.api.row('Plants', 'P01');
    await this.api.saveRow('Plants', { ...row, title: 'Personal rose' });
  }

  async invalidCandidates() {
    const meta = await (await this.api.call('GET', '/api/table/Plants:meta', undefined, [200], 'read Plants metadata')).json();
    await this.api.call('PUT', '/api/table_def/Plants', {
      columns: meta.columns.map(c => ({ ...c, ...(c.column_name === 'title' ? { reqd: true } : {}) })),
    }, [200], 'require plant title');
    await this.change(["update $plants set name = case when code = 'P01' then 'Valid change' else null end"]);
    this.before = (await acceptanceSql("select count(*)::int as n from featherbase.import_log where ref_table = 'Plants'"))[0].n;
    this.conflictsBefore = (await acceptanceSql("select count(*)::int as n from featherbase.import_conflict where ref_table = 'Plants'"))[0].n;
  }

  async run() {
    if (!this.job) await this.schedule();
    // A new process must recover persisted handlers, not rely on the save request.
    await restartAcceptance();
    await acceptanceSql('update featherbase.background_job set run_at = now(), max_attempts = 1 where method = $1 and job_status = \'queued\'', [this.job.method]);
    const deadline = Date.now() + 30_000;
    do {
      const rows = await acceptanceSql('select * from featherbase.job_execution where method = $1 order by started_at desc limit 1', [this.job.method]);
      if (rows.length) { this.execution = rows[0]; return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error('The real worker did not execute the due Plants refresh');
  }

  async conflicts() {
    return (await this.api.call('GET', '/api/table/Plants:import-conflicts', undefined, [200], 'read Plants conflicts')).json();
  }

  async assertSystemBatch() {
    assert.equal(this.execution.outcome, 'success');
    const info = await (await this.api.call('GET', '/api/table/Plants:copy_info', undefined, [200], 'read copy batch')).json();
    const logs = await acceptanceSql("select batch_id, created_by from featherbase.import_log where ref_table = 'Plants' and batch_id = $1", [info.last_run_id]);
    assert.ok(logs.length > 0, 'the scheduled run has an ordinary undoable batch');
    assert.ok(logs.every(l => l.created_by.startsWith('copy-refresh:')));
    const versions = await acceptanceSql("select created_by from featherbase.version where ref_table = 'Plants' and data->>'import_run' = $1", [info.last_run_id]);
    // A conflict-only run changes no stored values, so it needs no row version.
    assert.ok(versions.every(v => v.created_by.startsWith('copy-refresh:')));
    await this.api.call('POST', '/api/table/Plants:import-revert', { run_id: info.last_run_id }, [201], 'undo scheduled copy');
  }

  async remove() {
    await this.api.call('DELETE', '/api/table_def/Plants', undefined, [200], 'remove Plants');
  }
}

module.exports = { CopyRefreshFixture };
