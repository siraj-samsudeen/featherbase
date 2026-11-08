'use strict';

// The Assets app (client-apps/jeyarama/equipment), driven over HTTP as named people, and its
// pages read in their browsers. Steps never see a URL or a selector: they ask this flow.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { Api, SYSTEM_MANAGER } = require('../api');
const { REPO_ROOT, BASE_URL, restartAcceptance } = require('../stack');

const APP_PATH = resolve(REPO_ROOT, 'client-apps/jeyarama/equipment');
const appEnvironment = { FEATHERBASE_APP_PATHS: JSON.stringify([APP_PATH]) };
// Assets records upgrade steps, so its Tables answer only a client that names the installed version.
const VERSION = require(resolve(APP_PATH, 'package.json')).version;
const APP_HEADER = { 'X-Featherbase-App-Version': `equipment@${VERSION}` };
let discovered = false;

/** Who is who in the Assets specs, and their Featherbase roles. */
const CAST = {
  'the user': ['Assets Manager'],
  'a manager': ['Assets Manager'],
  Meena: ['Assets Manager'],
  'the asset accountant': ['Assets Manager'],
  Ravi: ['Assets Technician'],
  Suresh: ['Assets Member'],
  'store staff': ['Assets Member'],
  'a member': ['Assets Member'],
  'another member': ['Assets Member'],
};

async function systemManager() {
  const api = await Api.asSystemManager();
  return new Api(api.ctx, { ...api.headers, ...APP_HEADER });
}

/** Setup runs as the System Manager, admitted as an Assets Manager: installing grants no app access. */
async function admitSystemManager() {
  const api = await systemManager();
  const admin = await api.row('Person', SYSTEM_MANAGER.user);
  if (!admin.roles.some(entry => entry.role === 'Assets Manager'))
    await api.call('POST', '/api/save_row', { table: 'Person', row: { row_id: admin.row_id, updated_at: admin.updated_at, roles: [...admin.roles, { role: 'Assets Manager' }] } }, [201], 'admit the System Manager to Assets');
}

class Assets {
  constructor(world) {
    this.world = world;
    this.ids = {}; // person name -> Person row_id
    this.names = {}; // Person row_id -> person name
    this.places = {}; // place name -> row_id
    this.types = {}; // asset type -> row_id
    this.entities = {}; // short name -> row_id
    this.assets = {}; // asset name -> row_id
    this.last = null; // the last call's { status, body }, for "it is refused"
  }

  /** Installs Assets once per scenario and makes its people. */
  async setup() {
    if (this.ready) return;
    if (!discovered) { await restartAcceptance(appEnvironment); discovered = true; }
    const install = async () => {
      const response = await (await systemManager()).call('POST', '/api/install_app', { name: 'equipment' });
      if (response.status() !== 201 && response.status() !== 409) throw new Error(`install Assets: ${response.status()} ${await response.text()}`);
    };
    try { await install(); }
    catch (error) {
      // Another scenario restarted the stack without Assets: discover it again.
      if (!/Unknown app: equipment/.test(String(error?.message))) throw error;
      await restartAcceptance(appEnvironment);
      await install();
    }
    await admitSystemManager();
    this.ready = true;
  }

  /** A person of the scenario, made the first time they are named, with their full name. */
  async who(name) {
    await this.setup();
    if (this.ids[name]) return this.ids[name];
    const roles = CAST[name];
    if (!roles) throw new Error(`Assets has no one called "${name}"`);
    const person = await this.world.person(name, roles);
    const api = await systemManager();
    const filters = encodeURIComponent(JSON.stringify([['email', '=', person.email]]));
    const found = await (await api.call('GET', `/api/table/Person?filters=${filters}&fields=["row_id","updated_at"]`, undefined, [200], 'find person')).json();
    const row = found.data[0];
    const fullName = name.replace(/^(a|an|the|another) /, '').replace(/^\w/, c => c.toUpperCase());
    await api.call('POST', '/api/save_row', { table: 'Person', row: { row_id: row.row_id, updated_at: row.updated_at, full_name: fullName } }, [201], 'name person');
    this.ids[name] = row.row_id;
    this.names[row.row_id] = fullName;
    return row.row_id;
  }

  /** Any call as a named person: { status, body }. */
  async call(name, path, data, method = 'POST') {
    await this.who(name);
    const page = await this.world.signedIn(name);
    // A page just signed in is still on about:blank, where storage can't be read.
    if (!page.url().startsWith(BASE_URL)) await page.goto(`${BASE_URL}/equipment/`);
    const token = await page.evaluate(() => localStorage.getItem('fc_token'));
    const response = await page.request.fetch(path, { method, data, headers: { Authorization: `Bearer ${token}`, ...APP_HEADER } });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    this.last = { status: response.status(), body };
    return this.last;
  }

  /** Saves a row as a person. With attempt, a refusal is kept in `last` instead of failing the step. */
  async save(name, table, row, attempt = false) {
    const response = await this.call(name, '/api/save_row', { table, row });
    if (!attempt) assert.equal(response.status, 201, `${table}: ${JSON.stringify(response.body)}`);
    return response.body;
  }

  /** Saves changes to an existing row as a person, from its current version. */
  async change(name, table, id, values, attempt = false) {
    const current = await this.get(table, id);
    return this.save(name, table, { row_id: id, updated_at: current.updated_at, ...values }, attempt);
  }

  /** Runs an Assets action as a person. */
  async act(name, action, payload, attempt = false) {
    const response = await this.call(name, `/api/app_actions/equipment/${action}`, { idempotencyKey: randomUUID(), payload });
    if (!attempt) assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.body)}`);
    return response.body?.result;
  }

  /** A row as stored, read as the System Manager. */
  async get(table, id) {
    await this.setup();
    const api = await systemManager();
    return (await api.call('GET', `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, undefined, [200], `read ${id}`)).json();
  }

  /** Rows of a table matching filters, read as the System Manager. */
  async list(table, filters = [], fields = ['row_id']) {
    await this.setup();
    const api = await systemManager();
    const query = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=500`;
    return (await (await api.call('GET', `/api/table/${encodeURIComponent(table)}?${query}`, undefined, [200], `list ${table}`)).json()).data;
  }

  /** A row saved by the System Manager for setup. */
  async setupRow(table, row) {
    const api = await systemManager();
    const response = await api.call('POST', '/api/save_row', { table, row }, [201], `set up ${table}`);
    return response.json();
  }

  /** The last call was refused, with a message matching `pattern` when given. */
  refused(pattern) {
    assert.ok(this.last, 'nothing was tried');
    assert.ok(this.last.status >= 400 && this.last.status < 500, `expected a refusal, got ${this.last.status}: ${JSON.stringify(this.last.body)}`);
    if (pattern) assert.match(JSON.stringify(this.last.body), pattern);
  }

  // ---- The pilot's places, types, legal entities and assets ----
  // The acceptance database lasts the whole run, so these are found by name before being made.

  async findOrMake(table, key, value, row) {
    await this.setup();
    const [found] = await this.list(table, [[key, '=', value]], ['row_id']);
    return found ? found.row_id : (await this.setupRow(table, row)).row_id;
  }

  /** A place; `parent` names the place it sits in. */
  async place(name, level = 'Site', parent = null, extra = {}) {
    this.places[name] ??= await this.findOrMake('equipment.place', 'place_name', name,
      { place_name: name, place_level: level, ...(parent ? { parent_place: await this.place(parent) } : {}), ...extra });
    return this.places[name];
  }

  async type(name) {
    this.types[name] ??= await this.findOrMake('equipment.asset_type', 'type_name', name, { type_name: name });
    return this.types[name];
  }

  async entity(shortName, status = 'Verified') {
    this.entities[shortName] ??= await this.findOrMake('equipment.entity', 'short_name', shortName, { entity_name: shortName, short_name: shortName, entity_status: status });
    return this.entities[shortName];
  }

  /** An asset in the register, made once by name. */
  async asset(name, place = 'ATK 1501', extra = {}) {
    await this.setup();
    if (this.assets[name]) return this.assets[name];
    const { type = 'Other', ...values } = extra;
    const row = await this.setupRow('equipment.asset', { asset_name: name, asset_type: await this.type(type), place: await this.place(place), ...values });
    this.assets[name] = row.row_id;
    return row.row_id;
  }

  // ---- Pages, as a person sees them ----

  /** Opens an Assets page (a hash route such as `asset=AST-0001` or `custody`) and returns its text. */
  async pageText(name, route) {
    await this.who(name);
    const page = await this.world.signedIn(name);
    await page.goto(`${BASE_URL}/equipment/`);
    await page.goto(`${BASE_URL}/equipment/#${route}`);
    await page.locator('main').waitFor();
    await page.waitForLoadState('networkidle');
    return page.locator('main').innerText();
  }

  /** The signed-in page of a person, for steps that click or type in Assets. */
  async page(name) {
    await this.who(name);
    return this.world.signedIn(name);
  }
}

module.exports = { Assets, BASE_URL };
