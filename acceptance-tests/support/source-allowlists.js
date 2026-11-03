'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Public save/read flow: no source driver, connection or control-database access.
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

  async dispose() {
    if (this.folder) await rm(this.folder, { recursive: true, force: true });
  }
}

module.exports = { SourceAllowlists };
