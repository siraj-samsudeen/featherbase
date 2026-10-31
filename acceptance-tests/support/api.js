'use strict';

// Setup through the API, signed in as the seeded System Manager: tables, rows,
// roles and people a scenario starts from. What a scenario then does and
// checks goes through the browser (support/pages/).

const { request } = require('playwright');
const { API_URL } = require('./stack');

// The seeded System Manager of a fresh database (apps/web/e2e/fixtures.ts).
const SYSTEM_MANAGER = { user: 'Administrator', password: process.env.ADMIN_PASSWORD ?? 'admin' };

class Api {
  static async asSystemManager() {
    const ctx = await request.newContext({ baseURL: API_URL });
    const login = await ctx.post('/api/login', {
      data: { usr: SYSTEM_MANAGER.user, pwd: SYSTEM_MANAGER.password },
    });
    if (!login.ok()) throw new Error(`API sign-in failed: ${login.status()} ${await login.text()}`);
    const { token } = await login.json();
    return new Api(ctx, { Authorization: `Bearer ${token}` });
  }

  constructor(ctx, headers) {
    this.ctx = ctx;
    this.headers = headers;
  }

  async dispose() {
    await this.ctx.dispose();
  }

  async call(method, path, data, expected, label) {
    const res = await this.ctx.fetch(path, { method, headers: this.headers, data });
    if (expected && !expected.includes(res.status()))
      throw new Error(`${label}: ${res.status()} ${await res.text()}`);
    return res;
  }

  /** Deletes a table left by an earlier scenario, so a create starts fresh. */
  async removeTableIfPresent(name) {
    const enc = encodeURIComponent(name);
    const meta = await this.call('GET', `/api/table/${enc}:meta`);
    if (meta.status() !== 200) return;
    const del = await this.call('DELETE', `/api/table_def/${enc}`);
    if (!del.ok()) throw new Error(`could not remove leftover table ${name}: ${del.status()} ${await del.text()}`);
  }

  /** Creates a table from { name, id_pattern, columns } and fills it with rows. */
  async createTable(def, rows = []) {
    await this.removeTableIfPresent(def.name);
    await this.call('POST', '/api/table_def', def, [201], `create table ${def.name}`);
    for (const row of rows)
      await this.call('POST', `/api/table/${encodeURIComponent(def.name)}`, row, [201], `add a row to ${def.name}`);
  }

  /** A role that may read this table (its basic columns). */
  async readerRoleFor(table) {
    const role = `${table} Reader`;
    const have = await this.call('GET', `/api/table/Role/${encodeURIComponent(role)}`);
    if (have.status() !== 200)
      await this.call('POST', '/api/save_row', { table: 'Role', row: { row_id: role } }, [201], `create role ${role}`);
    await this.call(
      'POST',
      '/api/save_row',
      { table: 'Permission', row: { ref_table: table, role, can_read: true } },
      [201],
      `let ${role} read ${table}`,
    );
    return role;
  }

  /** A new, enabled person with these roles and password. */
  async createPerson(email, password, roles) {
    const made = await this.call(
      'POST',
      '/api/save_row',
      { table: 'Person', row: { email, enabled: true, roles: roles.map((role) => ({ role })) } },
      [201],
      `create person ${email}`,
    );
    const { row_id } = await made.json();
    await this.call('POST', '/api/set_password', { user: row_id, password }, [200], `set password for ${email}`);
  }
}

module.exports = { Api, SYSTEM_MANAGER };
