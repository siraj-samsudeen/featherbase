'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketTransitions, plan } = require('../support/pages/ticket-transitions');

// #918: ticket type transitions. Exact spec sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketTransitions ??= new TicketTransitions(world.tickets);
  return world.ticketTransitions;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date', x => x.configure()],
  ['Anjali raised a Data Quality Issue for SAP, assigned to Bala', x => x.raise()],
  ['a Data Quality Issue that Bala has marked fixed', x => x.markedFixed()],
  ['the Data Quality Issue type is private', x => { x.private = true; }],
]);

steps(When, [
  ['Bala opens that ticket', async x => { x.page = await x.workflow('Bala'); }],
  ['Bala confirms it without a target date', x => x.take('Bala', 'Confirm', { fix_what: plan.fix_what, fix_where: plan.fix_where }, true)],
  ['Bala confirms it with what will be fixed, where, and a target date', x => x.confirmInPage()],
  ["support sets the ticket's state to {string} directly", (x, state) => x.t.action('edit', { state }, 'Support', true)],
  ['the verifier verifies it', x => x.take('DQ Verifier', 'Verify')],
  ['Bala asks {string} and Anjali answers {string}', async (x, question, answer) => {
    await x.take('Bala', 'Ask a question', { question });
    await x.take('Anjali', 'Answer', { answer });
    x.texts = [question, answer];
  }],
]);

steps(Then, [
  ['Bala is offered to confirm it, and Anjali is not', async x => {
    await x.page.getByRole('group', { name: 'Actions on this ticket' }).getByRole('button', { name: 'Confirm', exact: true }).waitFor();
    assert.deepEqual(await x.offered('Anjali'), []);
  }],
  ['the confirmation is refused as missing the target date', x => {
    assert.equal(x.t.last.status, 417);
    assert.match(JSON.stringify(x.t.last.body), /Target date is required/);
  }],
  ['the ticket is in {string}', async (x, state) => assert.equal((await x.t.open('Support')).ticket.ticket_state, state)],
  ['the change is refused and the ticket stays in {string}', async (x, state) => {
    assert.equal(x.t.last.status, 417, JSON.stringify(x.t.last.body));
    assert.equal((await x.t.open('Support')).ticket.ticket_state, state);
  }],
  ['Anjali and a Data Quality verifier may verify it, and Bala may not', async x => {
    await x.roleHolder();
    assert.deepEqual(await x.offered('Anjali'), ['Verify', 'Not fixed']);
    assert.deepEqual(await x.offered('DQ Verifier'), ['Verify']);
    assert.deepEqual(await x.offered('Bala'), []);
  }],
  ['the ticket is closed and leaves the open queue', async x => {
    assert.equal(x.t.ticket.ticket_state, 'Closed');
    assert.ok(!(await x.t.read('queue', { state: 'open' }, 'Support')).tickets.some(t => t.row_id === x.t.ticket.row_id));
  }],
  ['the ticket is back in {string} and its history shows Bala asking and Anjali answering, with both texts', async (x, state) => {
    assert.equal(x.t.ticket.ticket_state, state);
    const events = (await x.t.open('Support')).privateEvents.filter(e => e.operation === 'transition').map(e => ({ by: e.by, ...JSON.parse(e.text) }));
    assert.deepEqual(events.map(e => [e.by, e.action, Object.values(e.values)[0]]),
      [[x.t.ids.Bala, 'Ask a question', x.texts[0]], [x.t.ids.Anjali, 'Answer', x.texts[1]]]);
  }],
  ['a colleague sees that a question was asked and answered, but not {string}', async (x, secret) => {
    const seen = await x.t.open('Colleague');
    assert.deepEqual(seen.events.map(e => e.text), ['Ask a question: Raised → Waiting for raiser', 'Answer: Waiting for raiser → Raised']);
    assert.ok(!JSON.stringify(seen).includes(secret));
  }],
  ['a colleague reads the question and {string}', async (x, answer) => {
    const seen = await x.t.open('Colleague');
    assert.equal(seen.details.question, x.texts[0]);
    assert.equal(seen.details.answer, answer);
  }],
]);
