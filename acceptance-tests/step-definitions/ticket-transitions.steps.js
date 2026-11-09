'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketTransitions } = require('../support/pages/ticket-transitions');

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
  ['Anjali raised a Data Quality Issue for SAP, assigned to Bala', x => x.raise()],
  ['a Data Quality Issue that Bala has marked fixed', x => x.markedFixed()],
  ['the Data Quality Issue type is private', x => { x.private = true; }],
  ['a person who holds the "Data Quality Verifier" role and is not involved in the ticket', x => x.roleHolder()],
]);

steps(When, [
  ['that person opens the ticket in Tickets', async x => { x.page = await x.workflow('DQ Verifier'); }],
]);

steps(Then, [
  ['Tickets offers that person the verification', async x => {
    await x.page.getByRole('group', { name: 'Actions on this ticket' }).getByRole('button', { name: 'Verify', exact: true }).waitFor();
  }],
]);
