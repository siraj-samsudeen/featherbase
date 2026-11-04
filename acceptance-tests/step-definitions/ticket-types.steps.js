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
  ['a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later', x => x.configure()],
  ['the System Manager has removed its Urgency field', x => x.removeField('urgency')],
  ['Anjali submitted a Data Quality Issue raised on {string}', (x, date) => x.submit({ urgency: 'Now', raised_on: date })],
  ['Anjali submitted a Data Quality Issue with current value {string}', (x, value) => x.submit({ urgency: 'Now', current_value: value })],
  ['Anjali submitted a Data Quality Issue for SAP that also concerns StyleHR', async x => { await x.configure(); await x.submit({ urgency: 'Now', source_system: x.systems.SAP, also_concerns: x.systems.StyleHR }); }],
  ['the owners Table lists Bala as primary owner of SAP', x => x.configure()],
  ["a person who never used Tickets, whom Pat may see and Anjali may not", async x => { await x.configure(); await x.reader('Pat'); await x.outsider(); }],
  ['Tickets was turned off and then turned on again by another process while the server ran', x => x.restartedElsewhere()],
  ['the installed Tickets 0.1.0 records a different build than the one this server holds', x => x.changedBuild()],
  ["an administrator lists a Source System Table that only Pat may read in Tickets' linked_tables setting", async x => {
    await x.t.setup(); await x.reader('Pat'); await x.configure({ readers: 'Tickets Person Reader' });
  }],
]);

steps(When, [
  ['Anjali submits that Data Quality Issue without an urgency', x => x.submit({}, 'Anjali', true)],
  ['Anjali submits that Data Quality Issue with urgency {string}', (x, urgency) => x.submit({ urgency })],
  ['Anjali opens Tickets', async x => { x.answer = await x.t.call('Anjali', '/api/app_reads/tickets/session', { payload: {} }); if (x.key) x.view = await x.page('Anjali'); }],
  ["Anjali opens that ticket's page", async x => { x.view = await x.openTicket('Anjali'); }],
  ['support opens that ticket', async x => { x.seen = await detail(x, 'Support'); }],
  ['the colleague opens that ticket', async x => { x.seen = await detail(x, 'Colleague'); }],
  ['support resolves that ticket as {string}', (x, state) => x.t.action('resolve', { state, reason: 'Corrected in SAP', reference: 'Change note 1' }, 'Support')],
  ['Anjali submits a Data Quality Issue for SAP', async x => { await x.configure(); await x.submit({ urgency: 'Now', source_system: x.systems.SAP }); }],
  ['Pat raises a Data Quality Issue for that person', x => x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Pat')],
  ['Pat and Anjali open the Data Quality Issue form', async x => { x.forms = { Pat: await formType(x, 'Pat'), Anjali: await formType(x, 'Anjali') }; }],
]);

steps(Then, [
  ['the submission is refused as missing Urgency', x => { assert.equal(x.t.last.status, 417); assert.match(JSON.stringify(x.t.last.body), /Urgency is required/); }],
  ['the ticket starts in {string}', (x, state) => assert.equal(x.t.ticket.ticket_state, state)],
  ['that type is listed under Request types and offered in the new-ticket form', async x => {
    const page = x.view;
    assert.ok((await page.locator('.type-list').innerText()).includes('Data Quality Issue'));
    await page.getByRole('button', { name: /New ticket/ }).click();
    await page.locator('dialog select').first().selectOption(x.key);
    await page.locator('dialog').getByText('Urgency *').waitFor();
  }],
  ['its raised-on date reads {string} and no date on the page is written with slashes', async (x, date) => {
    const text = await x.view.locator('main').innerText();
    assert.ok(text.includes(date), `missing ${date}`);
    assert.doesNotMatch(text, /\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  }],
  ['both SAP and StyleHR are shown on the ticket', x => assert.deepEqual([x.seen.labels.source_system, x.seen.labels.also_concerns], ['SAP', 'StyleHR'])],
  ['its summary is shown and {string} is not', (x, value) => { assert.equal(x.seen.ticket.row_id, x.t.ticket.row_id); assert.ok(!JSON.stringify(x.seen).includes(value)); }],
  ['history records it, it leaves the open queue, and reopening returns it to {string}', async (x, state) => {
    assert.ok((await detail(x, 'Support')).privateEvents.some(event => event.operation === 'resolve'));
    assert.ok(!(await x.t.read('queue', { state: 'open' }, 'Support')).tickets.some(ticket => ticket.row_id === x.t.ticket.row_id));
    await x.t.action('reopen', { reason: 'Came back' }, 'Support');
    assert.equal(x.t.ticket.ticket_state, state);
  }],
  ['the ticket is assigned to Bala', x => assert.equal(x.t.ticket.assigned_to, x.t.ids.Bala)],
  ["the ticket shows that person's name, and Pat's form finds them by name", async x => {
    assert.equal((await detail(x, 'Pat')).names[x.outsiderId], x.outsiderName);
    const page = await x.page('Pat');
    await page.getByRole('button', { name: /New ticket/ }).click();
    await page.locator('dialog select').first().selectOption(x.key);
    await page.getByLabel('Raised for').fill(x.outsiderName);
    await page.locator('dialog').getByRole('option', { name: new RegExp(x.outsiderName) }).first().waitFor({ state: 'attached' });
  }],
  ['the same issue from Anjali is refused', async x => { await x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Anjali', true); assert.equal(x.t.last.status, 417); }],
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
