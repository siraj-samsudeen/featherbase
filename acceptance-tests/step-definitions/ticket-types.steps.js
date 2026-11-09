'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets, TicketTypes } = require('../support/pages/tickets');

// #912: instance-configured ticket types, install without restart, linked
// Tables. Exact spec sentences only; the World disposes people and pages.
const flow = world => {
  world.tickets ??= new Tickets(world);
  world.ticketTypes ??= new TicketTypes(world.tickets);
  return world.ticketTypes;
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};
const detail = (x, actor) => x.t.read('detail', { row_id: x.t.ticket.row_id }, actor);
const formType = async (x, actor) => (await x.t.read('form', {}, actor)).types.find(type => type.key === x.key);

steps(Given, [
  ['Tickets was turned off and then turned on again by another process while the server ran', x => x.restartedElsewhere()],
  ['the installed Tickets 0.1.0 records a different build than the one this server holds', x => x.changedBuild()],
  ["an administrator lists a Source System Table that only Pat may read in Tickets' linked_tables setting", async x => {
    await x.t.setup(); await x.reader('Pat'); await x.configure({ readers: 'Tickets Person Reader' });
  }],
]);

steps(When, [
  ['Anjali opens Tickets', async x => { x.answer = await x.t.call('Anjali', '/api/app_reads/tickets/session', { payload: {} }); if (x.key) x.view = await x.page('Anjali'); }],
  ['Pat and Anjali open the Data Quality Issue form', async x => { x.forms = { Pat: await formType(x, 'Pat'), Anjali: await formType(x, 'Anjali') }; }],
]);

steps(Then, [
  ['Tickets answers without a restart', x => assert.equal(x.answer.status, 200, JSON.stringify(x.answer.body))],
  ['the refusal says its files changed under the same version and how to fix it', async x => {
    try {
      assert.equal(x.answer.status, 403);
      assert.match(x.answer.body.error.message, /files changed on this server under the same version.*install-app tickets/);
    } finally { await x.restoreBuild(); }
  }],
  ["Pat's Source system field offers its rows and Anjali's offers none", x => {
    const options = form => form.fields.find(field => field.name === 'source_system').options.map(option => option.label).sort();
    assert.deepEqual(options(x.forms.Pat), ['SAP', 'StyleHR']);
    assert.deepEqual(options(x.forms.Anjali), []);
  }],
]);
