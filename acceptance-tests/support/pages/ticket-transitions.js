'use strict';

const assert = require('node:assert/strict');
const { TicketTypes, ticketsAdmin } = require('./tickets');

// #918: a Data Quality Issue type whose actions say who moves a ticket and
// what they record. Each scenario configures its own type key and Tables.
const plan = { fix_what: 'Door number in the plant address', fix_where: 'SAP plant master', target_date: '2026-11-10' };
const transitions = [
  { state: 'Raised', action: 'Confirm', next_state: 'Fix planned', allowed: 'assignee', fields: ['fix_what', 'fix_where', 'target_date'] },
  { state: 'Raised', action: 'Ask a question', next_state: 'Waiting for raiser', allowed: 'assignee', fields: ['question'] },
  { state: 'Waiting for raiser', action: 'Answer', next_state: 'Raised', allowed: 'requester', fields: ['answer'] },
  { state: 'Raised', action: 'Reject', next_state: 'Rejected', allowed: 'assignee', fields: ['rejection_reason'] },
  { state: 'Rejected', action: 'Reopen', next_state: 'Raised', allowed: 'requester' },
  { state: 'Fix planned', action: 'Mark fixed', next_state: 'Fixed: to verify', allowed: 'assignee', fields: ['what_changed'] },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'requester' },
  { state: 'Fixed: to verify', action: 'Verify', next_state: 'Closed', allowed: 'Data Quality Verifier' },
  { state: 'Fixed: to verify', action: 'Not fixed', next_state: 'Fix planned', allowed: 'requester', fields: ['still_wrong'] },
];
const actionFields = [
  ['fix_what', 'What will be fixed', 'long text'], ['fix_where', 'Where it will be fixed', 'text'], ['target_date', 'Target date', 'date'],
  ['question', 'Question', 'long text'], ['answer', 'Answer', 'long text'], ['rejection_reason', 'Why it is rejected', 'long text'],
  ['what_changed', 'What was changed', 'long text'], ['still_wrong', 'What is still wrong', 'long text'],
];

class TicketTransitions {
  constructor(tickets) { this.t = tickets; this.types = new TicketTypes(tickets); }
  async configure() {
    if (this.configured) return;
    await this.types.configure();
    const api = await ticketsAdmin();
    const type = await api.row('tickets.ticket_type', this.types.type.row_id);
    await api.saveRow('tickets.ticket_type', { ...type, states: ['Raised', 'Waiting for raiser', 'Fix planned', 'Fixed: to verify', 'Closed', 'Rejected'].join('\n'),
      done_states: 'Closed\nRejected', reopen_state: '', transitions: JSON.stringify(transitions),
      details_visible_to: this.private ? 'private' : 'everyone' });
    let order = 100;
    for (const [field_name, label, field_type] of actionFields)
      await api.saveRow('tickets.type_field', { ticket_type: this.types.type.row_id, field_order: ++order, field_name, label, field_type });
    this.configured = true;
  }
  async raise() {
    await this.configure();
    await this.types.submit({ urgency: 'Now', source_system: this.types.systems.SAP, current_value: '78/499/1' });
    assert.equal(this.t.ticket.assigned_to, this.t.ids.Bala);
  }
  take(actor, action, values, attempt = false) {
    return this.t.action('transition', { action, ...(values ? { values } : {}) }, actor, attempt);
  }
  async offered(actor) { return ((await this.t.open(actor)).actions ?? []).map(a => a.action); }
  async markedFixed() {
    await this.raise();
    await this.take('Bala', 'Confirm', plan);
    await this.take('Bala', 'Mark fixed', { what_changed: 'Corrected the door number for plant 1100' });
  }
  async roleHolder() {
    const api = await ticketsAdmin();
    await api.call('POST', '/api/save_row', { table: 'Role', row: { row_id: 'Data Quality Verifier' } }, [201, 409, 417], 'verifier role');
    await this.t.world.person('DQ Verifier', ['All', 'Data Quality Verifier']);
    this.verifierPage = await this.t.world.signedIn('DQ Verifier');
    await this.verifierPage.goto(`${require('../stack').BASE_URL}/tickets/`);
    this.t.ids['DQ Verifier'] = await this.verifierPage.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
  }
  async workflow(actor) {
    const page = await this.types.page(actor);
    await page.getByLabel('Search tickets').fill(this.t.ticket.row_id);
    await page.locator('.ticket-id', { hasText: this.t.ticket.row_id }).first().click();
    await page.locator('.ticket-kicker').waitFor();
    await page.getByRole('tab', { name: 'Workflow' }).click();
    await page.getByRole('heading', { name: 'Next step' }).waitFor();
    return page;
  }
}

module.exports = { TicketTransitions };
