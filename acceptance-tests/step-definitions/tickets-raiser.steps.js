'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketTransitions } = require('../support/pages/ticket-transitions');
const { TicketsRaiser } = require('../support/pages/tickets-raiser');

// #963: a System Manager corrects who raised a ticket. Exact spec sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketTransitions ??= new TicketTransitions(world.tickets);
  world.ticketsRaiser ??= new TicketsRaiser(world.ticketTransitions);
  return world.ticketsRaiser;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['Colleague has been disabled', x => x.disable('Colleague')],
]);

steps(When, [
  ['a System Manager changes the raiser to Colleague because {string}', (x, reason) => x.change('Manager', 'Colleague', reason)],
  ['a System Manager changes the raiser to Colleague without a reason', x => x.change('Manager', 'Colleague', '')],
  ['support changes the raiser to Colleague because {string}', (x, reason) => x.change('Support', 'Colleague', reason)],
  ['a System Manager saves the ticket directly with Colleague as its raiser', x => x.saveDirectly('Manager', 'Colleague')],
  ['Bala asks {string} and the ticket waits for its raiser', (x, question) => x.transitions.take('Bala', 'Ask a question', { question })],
  ["support opens the ticket's activity", x => x.openActivity('Support')],
]);

steps(Then, [
  ["Colleague reads the ticket's details, and Anjali no longer does", async x => {
    assert.ok((await x.t.open('Colleague')).details, 'the new raiser reads the details');
    assert.equal((await x.t.open('Anjali')).details, undefined);
  }],
  ['the ticket is still assigned to Bala and in {string}', async (x, state) => {
    const { ticket } = await x.t.open('Support');
    assert.equal(ticket.assigned_to, x.t.ids.Bala);
    assert.equal(ticket.ticket_state, state);
  }],
  ['Colleague may answer it, and Anjali may not', async x => {
    assert.deepEqual(await x.transitions.offered('Colleague'), ['Answer']);
    assert.deepEqual(await x.transitions.offered('Anjali'), []);
  }],
  ['the change of raiser is refused and Anjali is still the raiser', async x => {
    assert.ok([403, 417].includes(x.t.last.status), JSON.stringify(x.t.last.body));
    assert.equal((await x.t.open('Support')).ticket.owner, x.t.ids.Anjali);
  }],
  ['the history names Anjali, Colleague and the System Manager, and gives the reason', x => x.historyReads()],
]);
