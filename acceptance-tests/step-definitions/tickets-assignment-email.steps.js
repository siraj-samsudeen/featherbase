'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketsAssignmentEmail } = require('../support/pages/tickets-assignment-email');

// #1001: exact spec sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketsAssignmentEmail ??= new TicketsAssignmentEmail(world.tickets);
  return world.ticketsAssignmentEmail;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['Anjali has raised a ticket that support can assign', x => x.raise()],
  ["support has assigned Anjali's ticket to Colleague", x => x.assign('Colleague')],
  ['Colleague is listed as someone tickets can be assigned to', x => x.assignable('Colleague')],
]);

steps(When, [
  ["support assigns Anjali's ticket to Colleague", x => x.assign('Colleague')],
  ["support reassigns Anjali's ticket to Verifier", x => x.assign('Verifier')],
  ["support assigns Anjali's ticket to Verifier", x => x.assign('Verifier')],
  ["support assigns Anjali's ticket to themselves", x => x.assign('Support')],
]);

steps(When, [
  ['support assigns the ticket to Colleague on the ticket screen', x => x.assignOnScreen('Colleague')],
  ['support picks Colleague as the assignee on the ticket screen', x => x.pickOnScreen('Colleague')],
  ['support cancels the assignment', x => x.cancel()],
  ['Anjali opens her ticket on the ticket screen', async x => { x.page = await x.openOnScreen('Anjali'); }],
]);

steps(Then, [
  ['the ticket screen asks {string}', (x, question) => x.asks(question)],
  ['the ticket screen shows the ticket as Unassigned', x => x.showsUnassigned()],
  ['Anjali sees the ticket as Unassigned, with no way to assign it', x => x.requesterSees()],
  ['the link in the email opens that ticket for Colleague', x => x.followLink('Colleague')],
  ['{word} is emailed once about the ticket', async (x, name) => assert.equal((await x.mailTo(name)).length, 1)],
  ['nobody is emailed about the ticket', async x => assert.deepEqual(await x.mail(), [])],
  ['the email to Colleague names the ticket, who assigned it and a link to it', async x => {
    const [{ body }] = await x.mailTo('Colleague');
    assert.ok(body.includes(x.title), body);
    assert.ok(body.includes('assigned this ticket to you.'), body);
    assert.ok(body.includes(`/tickets/?ticket=${x.t.ticket.row_id}`), body);
  }],
  ['the email to {word} includes the description', async (x, name) => {
    assert.ok((await x.mailTo(name))[0].body.includes(x.description));
  }],
]);
