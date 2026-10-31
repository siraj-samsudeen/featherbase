'use strict';

// Setup through the API, signed in as the seeded System Manager: tables, rows,
// roles and people a scenario starts from. What a scenario then does and
// checks goes through the browser (support/pages/).

const { request } = require('playwright');
const { API_URL, BASE_URL } = require('./stack');

// The seeded System Manager of a fresh database (apps/web/e2e/fixtures.ts).
const SYSTEM_MANAGER = { user: 'Administrator', password: process.env.ADMIN_PASSWORD ?? 'admin' };

/**
 * A browser session for this person, signed in without the form: the same
 * POST /api/login the sign-in form makes, through the web app's address so
 * its sid cookie lands there, plus what the web app writes down after a
 * sign-in (fc_token and fc_user in localStorage, apps/web/src/lib/api.ts).
 * Returned as a Playwright storageState for a new browser context.
 */
async function signedInState(user, password) {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const login = await ctx.post('/api/login', { data: { usr: user, pwd: password } });
    if (!login.ok()) throw new Error(`sign-in as ${user} failed: ${login.status()} ${await login.text()}`);
    const { token, user: sessionUser } = await login.json();
    const { cookies } = await ctx.storageState();
    return {
      cookies,
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'fc_token', value: token },
            { name: 'fc_user', value: JSON.stringify(sessionUser) },
          ],
        },
      ],
    };
  } finally {
    await ctx.dispose();
  }
}

let systemManagerApi = null; // one API session per run

class Api {
  /** The run's API session as the System Manager, signed in on first use. */
  static asSystemManager() {
    systemManagerApi ??= (async () => {
      const ctx = await request.newContext({ baseURL: API_URL });
      const login = await ctx.post('/api/login', {
        data: { usr: SYSTEM_MANAGER.user, pwd: SYSTEM_MANAGER.password },
      });
      if (!login.ok()) throw new Error(`API sign-in failed: ${login.status()} ${await login.text()}`);
      const { token } = await login.json();
      return new Api(ctx, { Authorization: `Bearer ${token}` });
    })();
    return systemManagerApi;
  }

  /** Ends the run's API session, if one was opened. */
  static async disposeAll() {
    const api = await systemManagerApi?.catch(() => null);
    systemManagerApi = null;
    await api?.dispose();
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

  /** Installs one of the platform's sample apps, unless its entry table is already there. */
  async installSampleApp(name, entryTable) {
    const has = await this.call('GET', `/api/table/${encodeURIComponent(entryTable)}:meta`);
    if (has.status() === 200) return;
    await this.call('POST', '/api/install_app', { name }, [201], `install the ${name} app`);
  }

  /** Saves a new row through the full trigger chain and returns it as stored. */
  async saveRow(table, row) {
    const res = await this.call('POST', '/api/save_row', { table, row }, [201], `add a row to ${table}`);
    const { row_id } = await res.json();
    return this.row(table, row_id);
  }

  /** The row IDs of a table, up to `limit`. */
  async rowIds(table, limit = 1) {
    const fields = encodeURIComponent(JSON.stringify(['row_id']));
    const res = await this.call(
      'GET',
      `/api/table/${encodeURIComponent(table)}?fields=${fields}&limit_page_length=${limit}`,
      undefined,
      [200],
      `list ${table}`,
    );
    return (await res.json()).data.map((r) => r.row_id);
  }

  /** One row of a table, as stored. */
  async row(table, rowId) {
    const res = await this.call(
      'GET',
      `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`,
      undefined,
      [200],
      `read ${rowId} of ${table}`,
    );
    return res.json();
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

module.exports = { Api, SYSTEM_MANAGER, signedInState };
