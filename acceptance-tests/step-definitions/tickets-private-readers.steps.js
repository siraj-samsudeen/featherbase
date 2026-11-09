'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketTransitions } = require('../support/pages/ticket-transitions');
const { TicketsPrivateReaders } = require('../support/pages/tickets-private-readers');

// #925: exact spec sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketTransitions ??= new TicketTransitions(world.tickets);
  world.ticketsPrivateReaders ??= new TicketsPrivateReaders(world.ticketTransitions);
  return world.ticketsPrivateReaders;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['Pat raised a Data Quality Issue for SAP on behalf of Ravi, and support assigned it to Colleague', x => x.raise('Pat', 'Ravi', 'Colleague')],
]);

steps(When, [
  ['support reassigns the ticket to Meera', x => x.assign('Meera')],
]);

steps(Then, [
  ["Colleague and Ravi read the ticket's details, but not support's history", async x => {
    for (const name of ['Colleague', 'Ravi']) assert.equal((await x.reads(name)).privateEvents, undefined);
    assert.ok((await x.t.open('Support')).privateEvents.length > 0, 'support keeps its history');
  }],
  ['Anjali, who is not named on the ticket, does not read them', x => x.readsNot('Anjali')],
  ["Meera reads the ticket's details, and Colleague no longer does", async x => { await x.reads('Meera'); await x.readsNot('Colleague'); }],
]);
