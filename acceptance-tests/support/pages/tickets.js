'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { Api } = require('../api');
const { REPO_ROOT, API_URL, BASE_URL, restartAcceptance, resetAcceptance } = require('../stack');
const appEnvironment = { FEATHERBASE_APP_PATHS: JSON.stringify([resolve(REPO_ROOT, 'example-apps/tickets')]) };
let packageDiscovered = false;
// Tickets records an upgrade step, so its Tables answer only a client that names
// the installed version (the generic Admin UI does the same).
const TICKETS_VERSION = require(resolve(REPO_ROOT, 'example-apps/tickets/package.json')).version;
async function ticketsAdmin() {
  const api = await Api.asSystemManager();
  return new Api(api.ctx, { ...api.headers, 'X-Featherbase-App-Version': `tickets@${TICKETS_VERSION}` });
}

// HTTP flow object: no private database setup or simulated business responses.
// The World owns every identity/session and disposes them after each scenario.
class Tickets {
  constructor(world) { this.world = world; this.actor = 'Support'; this.details = {}; this.last = null; }

  async setup() {
    if (this.ready) return;
    if (!packageDiscovered) { await restartAcceptance(appEnvironment); packageDiscovered = true; }
    const api = await ticketsAdmin();
    try { await api.installSampleApp('tickets', 'tickets.ticket'); }
    catch (error) {
      // Another scenario reset the stack without the Tickets package: discover it again.
      if (!/Unknown app: tickets/.test(String(error?.message))) throw error;
      await restartAcceptance(appEnvironment);
      await (await ticketsAdmin()).installSampleApp('tickets', 'tickets.ticket');
    }
    for (const name of ['Anjali', 'Colleague', 'Support', 'Verifier', 'Bala', 'Karthik', 'Shiva', 'Fulfiller']) {
      const staff = !['Anjali', 'Colleague'].includes(name);
      await this.world.person(name, staff ? ['Tickets Support'] : ['All']);
    }
    this.ids = {};
    for (const name of this.world.people.keys()) {
      const page = await this.world.signedIn(name);
      await page.goto(`${BASE_URL}/tickets/`);
      this.ids[name] = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
    }
    await this.configure({
      support_users: ['Support', 'Verifier', 'Bala', 'Karthik', 'Shiva', 'Fulfiller'].map(n => this.ids[n]),
      verification_admins: [this.ids.Verifier], fulfillment_admins: [this.ids.Fulfiller],
      approval_routes: { Kerala: [this.ids.Bala], Chennai: [this.ids.Karthik, this.ids.Shiva] }, restricted_resources: ['Bronze'],
    });
    this.ready = true;
  }

  async configure(values) {
    const api = await ticketsAdmin();
    for (const [key, value] of Object.entries(values)) {
      const existing = await api.call('GET', `/api/table/App%20Setting/tickets.${key}`, undefined, [200, 404], 'read Tickets setting');
      const current = existing.status() === 200 ? await existing.json() : {};
      await api.call('POST', '/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${key}`, updated_at: current.updated_at, value: JSON.stringify(value) } }, [201], 'configure Tickets');
    }
  }

  async call(name, path, data, method = 'POST') {
    const page = await this.world.signedIn(name);
    const token = await page.evaluate(() => localStorage.getItem('fc_token'));
    const response = await page.request.fetch(path, { method, data, headers: {
      Authorization: `Bearer ${token}`, 'X-Featherbase-App-Version': `tickets@${TICKETS_VERSION}`,
    } });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status(), body };
  }

  async action(name, payload = {}, actor = this.actor, attempt = false) {
    const response = await this.call(actor, `/api/app_actions/tickets/${name}`, {
      idempotencyKey: randomUUID(), payload: { ...(name === 'create' ? {} : this.revision()), ...payload },
    });
    this.last = response;
    if (!attempt) assert.equal(response.status, 200, JSON.stringify(response.body));
    if (response.status === 200 && response.body.result.ticket) this.ticket = response.body.result.ticket;
    return response;
  }

  revision() { return { row_id: this.ticket.row_id, updated_at: this.ticket.updated_at }; }
  async read(name, payload = {}, actor = this.actor) {
    const response = await this.call(actor, `/api/app_reads/tickets/${name}`, { payload });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.result.answer;
  }
  async open(actor = this.actor) { return this.read('detail', { row_id: this.ticket.row_id }, actor); }
  async text(actor = this.actor) { return JSON.stringify(await this.open(actor)); }
  async choose(name) { await this.setup(); this.actor = name; }

  async create(kind = 'access', details = {}, original = 'Please give me MotherDuck access') {
    await this.setup();
    this.details = kind === 'access' ? { email: 'anjali@example.com', scope: 'Gold sales, read only', ...details } : details;
    this.original = original;
    await this.action('create', { title: original, original, kind, details: this.details }, 'Anjali');
    this.initial = { ...this.ticket };
  }
  async access(email = 'anjali@example.com', scope = 'Gold sales, read only') { await this.create('access', { email, scope }); }
  async verified(active = true, region = 'Kerala') {
    if (!this.ticket) await this.access();
    await this.action('verify', { email: this.details.email, active, region, evidence: 'Fictional HR confirmation 2026-11-03' }, 'Verifier');
  }
  async approved(scope = 'Gold sales, read only', region = 'Kerala') {
    await this.access('anjali@example.com', scope);
    await this.verified(true, region);
    await this.action('decide', { decision: 'approved' }, region === 'Kerala' ? 'Bala' : 'Shiva');
  }
  async competingDecisions() {
    await this.access();
    await this.verified(true, 'Chennai');
    const revision = this.revision();
    // Real HTTP requests get separate host transactions, unlike pg-test's
    // single shared rollback transaction. Both contend for the same row.
    const outcomes = await Promise.all([
      this.call('Shiva', '/api/app_actions/tickets/decide', { idempotencyKey: randomUUID(), payload: { ...revision, decision: 'approved' } }),
      this.call('Karthik', '/api/app_actions/tickets/decide', { idempotencyKey: randomUUID(), payload: { ...revision, decision: 'rejected', reason: 'Conflicting decision' } }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 200).length, 1);
    assert.equal(outcomes.filter(result => [409, 417].includes(result.status)).length, 1);
    const winner = outcomes.find(result => result.status === 200).body.result.ticket;
    const saved = await this.open('Support');
    assert.equal(saved.ticket.ticket_state, winner.ticket_state);
    assert.equal(saved.privateEvents.filter(event => event.operation === 'decide').length, 1);
  }
  async complaint(original = 'Invoices cleared two days ago are missing from the report') { await this.create('freshness', { complaint: original }, original); }
  async finding() {
    await this.action('evidence', { expected: '2 invoices from source-check-1', observed: '0 from report-check-1',
      reference: 'source-check-1; report-check-1', observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' }, 'Support');
  }
  async resolved() { await this.complaint(); await this.finding(); await this.action('resolve', { reason: 'Report refreshed and both invoices present', reference: 'report-check-2' }, 'Support'); }
  async progress(employee = false) {
    await this.access();
    if (employee) await this.verified();
    await this.action('note', { text: 'PRIVATE support note 431' }, 'Support');
    await this.action('edit', { public_update: 'Support is checking this request' }, 'Support');
  }
  async changeDetails(patch) {
    this.details = { ...this.details, ...patch };
    await this.action('edit', { details: this.details });
  }
  async denied() { assert.ok([403, 409, 417].includes(this.last.status), JSON.stringify(this.last)); }
  async includes(...values) { const text = await this.text(); for (const value of values) assert.ok(text.includes(value), `missing ${value}: ${text}`); }
  async excludes(...values) { const text = await this.text(); for (const value of values) assert.ok(!text.includes(value), `leaked ${value}: ${text}`); }
  async unfulfilled() { assert.notEqual((await this.open()).ticket.ticket_state, 'Resolved'); }
  async cannotFulfill() { await this.action('fulfill', { reference: 'Stale or unauthorized completion' }, 'Fulfiller', true); await this.denied(); await this.unfulfilled(); }
  async forbiddenOrdinaryEdit() {
    const api = await ticketsAdmin();
    const request = await api.row('tickets.request', this.ticket.row_id);
    this.last = await this.call(this.actor, '/api/save_row', { table: 'tickets.request', row: { ...request,
      verification_key: 'forged-verification', approval_key: 'forged-approval',
    } });
    await this.denied();
    this.last = await this.call(this.actor, '/api/save_row', { table: 'tickets.ticket', row: { ...this.ticket, ticket_state: 'Resolved' } });
    await this.denied();
    this.last = await this.call(this.actor, '/api/save_row', { table: 'tickets.event', row: {
      ticket: this.ticket.row_id, operation: 'verify', by: this.ids.Verifier, at: '2026-11-03T09:00:00Z',
      text: JSON.stringify({ email: this.details.email, active: true, region: 'Kerala', verification_key: request.verification_key }),
    } });
  }
  async publicPrivacy(owner = false) {
    const detail = await this.open();
    const text = JSON.stringify(detail);
    assert.ok(text.includes('Support is checking this request'));
    for (const secret of ['PRIVATE support note 431', 'Fictional HR confirmation']) assert.ok(!text.includes(secret));
    if (!owner) { assert.equal(detail.details, undefined); assert.ok(!text.includes('anjali@example.com')); }
    for (const table of ['tickets.ticket', 'tickets.event', ...(owner ? [] : ['tickets.request'])]) {
      const list = await this.call(this.actor, `/api/table/${table}?limit_page_length=500`, undefined, 'GET');
      assert.ok([200, 403].includes(list.status));
      const body = JSON.stringify(list.body);
      for (const secret of ['PRIVATE support note 431', 'Fictional HR confirmation']) assert.ok(!body.includes(secret));
      if (!owner) assert.ok(!body.includes('anjali@example.com'));
    }
    const activity = await this.call(this.actor, `/api/activity/tickets.ticket/${this.ticket.row_id}`, undefined, 'GET');
    assert.equal(activity.status, 200);
    assert.ok(!JSON.stringify(activity.body).includes('PRIVATE support note 431'));
  }
  async search(query) { this.queue = (await this.read('queue', { search: query })).tickets; }
  async referenceFixture(reference) {
    await this.setup();
    const api = await ticketsAdmin();
    // Allocate the exact example reference through normal naming and creation,
    // rather than bypassing Tickets' generic-write protection for a fixture.
    const metadata = await api.call('GET', '/api/table/tickets.ticket:meta', undefined, [200], 'read naming');
    const { id_pattern } = await metadata.json();
    await api.call('PUT', '/api/table_def/tickets.ticket/id_pattern', { id_pattern: 'field:title' }, [200], 'configure fixture naming');
    try {
      await this.action('create', { title: reference, original: 'Copied reference fixture', kind: 'generic', details: {} }, 'Anjali');
      assert.equal(this.ticket.row_id, reference);
    } finally {
      await api.call('PUT', '/api/table_def/tickets.ticket/id_pattern', { id_pattern }, [200], 'restore naming');
    }
  }
  async assignedTicket() {
    await this.setup();
    await this.access(); await this.action('edit', { assigned_to: this.ids.Support }, 'Support');
    this.assigned = this.ticket;
  }
  async assignedWork() {
    await this.create('report', { format: 'Excel' }, 'A colleague report');
    await this.action('edit', { assigned_to: this.ids.Bala }, 'Support'); this.unrelated = this.ticket;
    this.ticket = this.assigned;
  }
  async connections() { this.connectionStatus = (await this.read('session')).connections; }
  async ordinaryInstall() {
    await Api.disposeAll();
    await resetAcceptance(appEnvironment);
    packageDiscovered = true;
    await this.setup();
    this.beforeQueue = (await this.read('queue')).tickets;
    assert.deepEqual(this.beforeQueue, [], 'a fresh install must have no business samples');
  }
  async loadSamples() {
    // Explicit development-only package script, never a product action or normal install hook.
    const { seedTickets } = await import(pathToFileURL(resolve(REPO_ROOT, 'tools/seed-tickets-development.mjs')).href);
    await seedTickets({ baseUrl: API_URL, password: process.env.ADMIN_PASSWORD ?? 'admin', expectedEnvironment: 'test' });
    this.queue = (await this.read('queue')).tickets;
  }
  async fictionalEvidence() {
    const api = await ticketsAdmin();
    for (const table of ['tickets.request', 'tickets.event']) {
      const fields = table === 'tickets.request' ? ['row_id', 'original'] : ['row_id', 'operation', 'text'];
      const params = new URLSearchParams({ limit_page_length: '500', fields: JSON.stringify(fields) });
      const response = await api.call('GET', `/api/table/${table}?${params}`, undefined, [200], 'inspect explicit fictional samples');
      const { data } = await response.json();
      const evidence = table === 'tickets.event' ? data.filter(row => ['verify', 'evidence'].includes(row.operation)) : data;
      assert.ok(evidence.length > 0);
      for (const row of evidence) assert.match(JSON.stringify(row), /fictional/i);
    }
  }
}

// #912: a ticket type configured by a System Manager, as rows, never code.
// Each scenario gets its own type key and its own instance Tables, so the
// shared acceptance database never sees two scenarios' configuration collide.
class TicketTypes {
  constructor(tickets) { this.t = tickets; }
  async api() { return ticketsAdmin(); }
  async setting(name, value) {
    const api = await this.api();
    const existing = await api.call('GET', `/api/table/App%20Setting/tickets.${name}`, undefined, [200, 404], 'read Tickets setting');
    const current = existing.status() === 200 ? await existing.json() : {};
    await api.call('POST', '/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, updated_at: current.updated_at, value: JSON.stringify(value) } }, [201], 'configure Tickets');
  }
  async configure({ readers = 'All' } = {}) {
    await this.t.setup();
    if (this.key) return;
    const api = await this.api();
    const tag = randomUUID().slice(0, 6);
    this.key = `dq_${tag}`;
    this.systemsTable = `Source System ${tag}`;
    this.ownersTable = `System Owner ${tag}`;
    await api.createTable({ name: this.systemsTable, title_column: 'source_system', columns: [{ column_name: 'source_system', column_type: 'Data', reqd: true }] });
    await api.createTable({ name: this.ownersTable, columns: [
      { column_name: 'source_system', column_type: 'Reference', reference_table: this.systemsTable },
      { column_name: 'person', column_type: 'Data' }, { column_name: 'is_primary', column_type: 'Check' }] });
    if (readers !== 'All') await api.call('POST', '/api/save_row', { table: 'Role', row: { row_id: readers } }, [201, 409, 417], 'reader role');
    for (const table of [this.systemsTable, this.ownersTable])
      await api.grant(table, readers, ['read']);
    this.systems = {};
    for (const name of ['SAP', 'StyleHR']) this.systems[name] = (await api.saveRow(this.systemsTable, { source_system: name })).row_id;
    await api.saveRow(this.ownersTable, { source_system: this.systems.SAP, person: this.t.ids.Bala, is_primary: true });
    const linked = await api.call('GET', '/api/table/App%20Setting/tickets.linked_tables', undefined, [200, 404], 'read linked tables');
    const before = linked.status() === 200 ? JSON.parse((await linked.json()).value || '[]') : [];
    await this.setting('linked_tables', [...before, this.systemsTable, this.ownersTable]);
    this.type = await api.saveRow('tickets.ticket_type', { type_key: this.key, label: 'Data Quality Issue', enabled: true,
      states: ['Open', 'In progress', 'Fixed in source', 'Answered', 'Reopened'].join('\n'), done_states: 'Fixed in source\nAnswered', reopen_state: 'Reopened', details_visible_to: 'private',
      routing: JSON.stringify({ field: 'source_system', table: this.ownersTable, match: 'source_system', person: 'person', primary: 'is_primary' }) });
    const fields = [
      { field_name: 'source_system', label: 'Source system', field_type: 'link', link_table: this.systemsTable, link_label: 'source_system' },
      { field_name: 'also_concerns', label: 'Also concerns', field_type: 'link', link_table: this.systemsTable, link_label: 'source_system' },
      { field_name: 'current_value', label: 'Current value', field_type: 'long text' },
      { field_name: 'urgency', label: 'Urgency', field_type: 'choice', choices: 'Now\nLater', required: true },
      { field_name: 'raised_on', label: 'Raised on', field_type: 'date' },
      { field_name: 'raised_for', label: 'Raised for', field_type: 'person' },
    ];
    this.fields = {};
    let order = 0;
    for (const field of fields) this.fields[field.field_name] = await api.saveRow('tickets.type_field', { ticket_type: this.type.row_id, field_order: ++order, ...field });
  }
  async removeField(name) {
    const api = await this.api();
    const field = this.fields[name];
    await api.call('DELETE', `/api/table/tickets.type_field/${field.row_id}?updated_at=${encodeURIComponent(field.updated_at)}`, undefined, [200, 202, 204], 'remove a field');
  }
  async submit(details = {}, actor = 'Anjali', attempt = false) {
    await this.configure();
    return this.t.action('create', { title: 'Plant address is wrong', original: 'Two plants carry both door numbers', kind: this.key, details }, actor, attempt);
  }
  async page(actor, path = '/tickets/') {
    const page = await this.t.world.signedIn(actor);
    await page.goto(`${BASE_URL}${path}`);
    await page.getByRole('button', { name: /New ticket/ }).first().waitFor();
    return page;
  }
  async openTicket(actor) {
    const page = await this.page(actor);
    await page.getByLabel('Search tickets').fill(this.t.ticket.row_id);
    await page.locator('.ticket-id', { hasText: this.t.ticket.row_id }).first().click();
    await page.getByRole('heading', { name: 'Original message' }).waitFor();
    return page;
  }
  async reader(name) {
    const api = await this.api();
    await api.call('POST', '/api/save_row', { table: 'Role', row: { row_id: 'Tickets Person Reader' } }, [201, 409, 417], 'person reader role');
    const existing = await api.call('GET', `/api/table/Permission?filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', 'Person'], ['role', '=', 'Tickets Person Reader']]))}`, undefined, [200], 'find Person grant');
    if (!(await existing.json()).data.length) await api.grant('Person', 'Tickets Person Reader', ['read']);
    await this.t.world.person(name, ['All', 'Tickets Person Reader']);
    const page = await this.t.world.signedIn(name);
    await page.goto(`${BASE_URL}/tickets/`);
    this.t.ids[name] = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
  }
  async outsider() {
    await this.t.world.person('Outsider', ['All']);
    const page = await this.t.world.signedIn('Outsider');
    await page.goto(`${BASE_URL}/featherbase/`);
    this.outsiderId = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
    this.outsiderName = `Outside Owner ${randomUUID().slice(0, 4)}`;
    const api = await this.api();
    const current = await api.row('Person', this.outsiderId);
    await api.call('POST', '/api/save_row', { table: 'Person', row: { row_id: this.outsiderId, updated_at: current.updated_at, full_name: this.outsiderName } }, [200, 201], 'name the outsider');
  }
}

module.exports = { Tickets, TicketTypes, ticketsAdmin };
