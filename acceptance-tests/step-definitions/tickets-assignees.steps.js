'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketsAssignees } = require('../support/pages/tickets-assignees');

// #964: exact spec sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketsAssignees ??= new TicketsAssignees(world.tickets);
  return world.ticketsAssignees;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['Colleague is listed only as someone tickets can be assigned to', x => x.list(['Colleague'])],
  ['no one is listed as someone tickets can be assigned to', x => x.list([])],
]);

steps(When, [
  ["support assigns Anjali's ticket to Colleague", x => x.assign('Colleague')],
]);

steps(Then, [
  ['the assign picker offers Colleague and Support', async x => {
    const offered = await x.offered();
    for (const name of ['Colleague', 'Support']) assert.ok(offered.includes(x.t.ids[name]), `${name} is offered: ${offered}`);
    assert.equal((await x.t.open('Support')).ticket.assigned_to, x.t.ids.Colleague);
  }],
  ['Colleague has no support rights', async x => {
    const session = await x.session('Colleague');
    assert.equal(session.capabilities.support, false);
    assert.equal(session.people, undefined);
    await x.t.action('edit', { public_update: 'Looking' }, 'Colleague', true);
    assert.ok([403, 417].includes(x.t.last.status), JSON.stringify(x.t.last.body));
  }],
  ['the assign picker offers Support and not Colleague', async x => {
    const offered = await x.offered();
    assert.ok(offered.includes(x.t.ids.Support), `Support is offered: ${offered}`);
    assert.ok(!offered.includes(x.t.ids.Colleague), `Colleague is not offered: ${offered}`);
  }],
]);
