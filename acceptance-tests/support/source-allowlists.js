'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { default: postgres } = require('postgres');
const { isolatedEnvironment, acceptanceSql, restartAcceptance } = require('./stack');

// Save/read/connect use the public API. Only Given setup installs legacy text
// directly, since today's save validation must not admit yesterday's bad rows.
class SourceAllowlists {
  constructor(api, engine, namespace) {
    this.api = api;
    this.source = {
      row_id: `allowlist-${randomUUID()}`,
      engine,
      default_schema: namespace,
      access: 'read_only',
      // Unique, unset even when the developer has real source credentials.
      // Successful SQL saves therefore prove registration needs no connection.
      url_env: `ACCEPTANCE_UNSET_${randomUUID().replaceAll('-', '_')}`,
    };
  }

  async prepare() {
    if (this.source.engine === 'csv-folder') {
      this.folder = await mkdtemp(path.join(tmpdir(), 'featherbase-allowlist-'));
      this.source.root_path = this.folder;
      delete this.source.url_env;
    }
  }

  async saveRestriction(entry) {
    this.requestedRestriction = entry;
    this.response = await this.api.call('POST', '/api/save_row', {
      table: 'Data Source',
      row: { ...this.source, table_allowlist: entry },
    });
    this.body = await this.response.json();
  }

  async register(entry) {
    await this.saveRestriction(entry);
    await this.expectRegistered(entry);
    this.source = await this.api.row('Data Source', this.source.row_id);
  }

  expectRefused(format) {
    assert.equal(this.response.status(), 417,
      `Expected restriction validation refusal (417), received ${this.response.status()}: ${JSON.stringify(this.body)}`);
    assert.equal(this.body.error?.type, 'ValidationError');
    const guidance = this.body.error?.fields?.table_allowlist;
    assert.equal(typeof guidance, 'string', 'Correction belongs to the table restriction field');
    assert.ok(guidance.includes(format), `Restriction guidance must include ${format}: ${guidance}`);
  }

  async expectNotRegistered() {
    const response = await this.api.call('GET', `/api/table/Data%20Source/${encodeURIComponent(this.source.row_id)}`);
    assert.equal(response.status(), 404, 'A refused create must not register the source');
  }

  async expectRegistered(entry = this.requestedRestriction) {
    assert.equal(this.response.status(), 201, JSON.stringify(this.body));
    await this.expectStored(entry);
  }

  async expectStored(entry) {
    const stored = await this.api.row('Data Source', this.source.row_id);
    assert.equal(stored.table_allowlist, entry, 'Stored restriction must remain exact');
  }

  async prepareLegacyRestriction(entry) {
    const control = new URL(isolatedEnvironment().DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(control.hostname),
      'Legacy source fixtures may only use local Postgres');
    assert.equal(control.pathname, '/featherbase_acceptance_e2e', 'Only the disposable acceptance control is permitted');
    this.databaseName = `issue780_allowlist_${randomUUID().replaceAll('-', '')}`;
    this.assertOwnedDatabase();
    const adminUrl = new URL(control);
    adminUrl.pathname = '/postgres';
    this.databaseAdmin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5, onnotice() {} });
    await this.databaseAdmin.unsafe(`create database "${this.databaseName}"`);
    this.databaseCreated = true;

    const sourceUrl = new URL(control);
    sourceUrl.pathname = `/${this.databaseName}`;
    const external = postgres(sourceUrl.toString(), { max: 1, connect_timeout: 5, onnotice() {} });
    try {
      await external`create table public.stores (id integer primary key, note text)`;
      await external`insert into public.stores (id, note) values (1, 'legacy allowlist fixture')`;
    } finally {
      await external.end({ timeout: 5 });
    }

    // Register an unrestricted source normally, then arrange the stored legacy
    // row without routing it through the new save validator.
    await this.saveRestriction('');
    assert.equal(this.response.status(), 201, JSON.stringify(this.body));
    this.legacySourceRegistered = true;
    const updated = await acceptanceSql(
      'update featherbase.data_source set table_allowlist = $1 where row_id = $2 returning row_id',
      [entry, this.source.row_id],
    );
    assert.equal(updated.length, 1, 'Exactly this scenario source gets legacy text');
    this.runtimeEnvApplied = true;
    await restartAcceptance({ [this.source.url_env]: sourceUrl.toString() });
    await this.expectStored(entry);
  }

  assertOwnedDatabase() {
    assert.match(this.databaseName, /^issue780_allowlist_[a-f0-9]{32}$/,
      'Create/drop only this flow\'s generated source database');
  }

  async connectStores() {
    this.tablePrefix = `Allowlist ${randomUUID().replaceAll('-', '')}`;
    this.response = await this.api.call('POST',
      `/api/table/Data%20Source/${encodeURIComponent(this.source.row_id)}:reflect`,
      { schema: 'public', tables: ['stores'], prefix: this.tablePrefix });
    this.body = await this.response.json();
    // Remember created metadata even if a subsequent expectation fails.
    this.createdTables = (this.body.created ?? []).map(table => table.name);
  }

  expectConnectionRefused(format) {
    assert.equal(this.response.status(), 403, JSON.stringify(this.body));
    assert.equal(this.body.error?.type, 'PermissionError');
    assert.ok(this.body.error.message.includes(format),
      `Connection refusal must explain ${format}: ${this.body.error.message}`);
  }

  async expectStoresConnected() {
    assert.equal(this.response.status(), 200, JSON.stringify(this.body));
    assert.equal(this.body.created.length, 1, 'Exactly one source table connects');
    assert.equal(this.body.created[0].table, 'stores');
    assert.deepEqual(this.body.skipped, []);
    await this.expectOwnedBinding(this.body.created[0].name);
  }

  async expectOwnedBinding(name) {
    const response = await this.api.call('GET', `/api/table/${encodeURIComponent(name)}:meta`,
      undefined, [200], 'read the connected Table metadata');
    const meta = await response.json();
    assert.equal(meta.data_source, this.source.row_id, 'The Table belongs to this scenario source');
    assert.equal(meta.external_schema, 'public');
    assert.equal(meta.external_table, 'stores');
  }

  async dispose() {
    try {
      for (const name of this.createdTables ?? []) {
        await this.expectOwnedBinding(name);
        await this.api.removeTableIfPresent(name);
      }
      if (this.legacySourceRegistered) {
        await this.api.call('DELETE', `/api/table/Data%20Source/${encodeURIComponent(this.source.row_id)}`,
          undefined, [200], 'remove the legacy fixture source');
      }
    } finally {
      try {
        // Clear only our unique env override; all other scenario settings stay.
        // Restart also closes any source pools before its database is dropped.
        if (this.runtimeEnvApplied) await restartAcceptance({ [this.source.url_env]: '' });
      } finally {
        try {
          if (this.databaseCreated) {
            this.assertOwnedDatabase();
            await this.databaseAdmin.unsafe(`drop database "${this.databaseName}" with (force)`);
          }
        } finally {
          await this.databaseAdmin?.end({ timeout: 5 });
          if (this.folder) await rm(this.folder, { recursive: true, force: true });
        }
      }
    }
  }
}

module.exports = { SourceAllowlists };
