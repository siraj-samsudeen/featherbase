'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const flow = world => (world.tickets ??= new Tickets(world));
// Exact spec sentences are registered, not a catch-all/pending implementation.
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    // Cucumber validates callback arity against expression parameters.
    const invoke = async function (...args) { return run(flow(this), ...args); };
    Object.defineProperty(invoke, 'length', { value: run.length - 1 });
    keyword(sentence, invoke);
  }
};

steps(Given, [
  ['the user is signed in as Anjali', t => t.choose('Anjali')],
  ['Anjali submitted {string} as a free-text request', (t, original) => t.create('generic', {}, original)],
  ['the user is authorized to triage the ticket', t => t.choose('Support')],
  ['Anjali has a ticket with reference {string}', (t, reference) => t.referenceFixture(reference)],
  ['Anjali has an open access ticket assigned to the user', t => t.assignedTicket()],
  ['another open report ticket is assigned to a colleague', async t => { await t.setup(); await t.assignedWork(); }],
  ['Anjali has an access ticket with public progress and a support-only note', t => t.progress()],
  ['Anjali has an access ticket with public progress and private employee-verification evidence', t => t.progress(true)],
  ['Anjali has an access ticket visible in the shared queue', t => t.access()],
  ['the user is another requester without support permissions', t => t.choose('Colleague')],
  ['Anjali reports {string}', (t, original) => t.complaint(original)],
  ['the user is authorized to investigate the ticket', t => t.choose('Support')],
  ['the user is authorized to investigate tickets but not fulfill access', t => t.choose('Support')],
  ["Anjali's missing-invoice ticket is being investigated", t => t.complaint()],
  ["Anjali's missing-invoice ticket has a recorded mismatch", async t => { await t.complaint(); await t.finding(); }],
  ["Anjali's missing-invoice ticket was resolved with a recorded finding and evidence", t => t.resolved()],
  ['Anjali has an unapproved access request', t => t.access()],
  ['Tickets has no live integration configuration', t => t.setup()],
  ['the user is authorized to manage support', t => t.choose('Support')],
  ['Tickets was installed without requesting development samples', t => t.ordinaryInstall()],
  ['Tickets is running in a development instance without real business requests', t => t.ordinaryInstall()],
]);

steps(When, [
  ['the user submits {string} as a free-text request', (t, text) => t.create('generic', {}, text)],
  ['the user requests MotherDuck access for {string} to {string}', (t, email, scope) => t.access(email, scope)],
  ['the user requests an Excel sales report for Palakkad from 2026-10-01 through 2026-10-31', t => t.create('report', { location: 'Palakkad', from: '2026-10-01', through: '2026-10-31', format: 'Excel' })],
  ['the user reports missing cleared Zakya invoices for 2026-11-01 in the daily sales report', t => t.create('freshness', { source: 'Zakya', report: 'daily sales', date: '2026-11-01', expected: 'cleared invoices' })],
  ['the user requests a new vendor API source for daily stock movements with an hourly refresh', t => t.create('source', { source: 'vendor API', data: 'daily stock movements', refresh: 'hourly' })],
  ['the user classifies it as access and records {string} as the requested scope', async (t, scope) => { t.details = { email: 'anjali@example.com', scope }; await t.action('edit', { kind: 'access', details: t.details }); }],
  ['the user searches for {string}', (t, text) => t.search(text)],
  ["the user attempts to rename Anjali's ticket", t => t.renameTicket()],
  ['Administrator attempts to delete its evidence using the current revision', t => t.deleteEvidence()],
  ['the user requests their open access work', async t => { t.queue = (await t.read('queue', { kind: 'access', state: 'Needs verification', assigned_to: t.ids.Support })).tickets; }],
  ['the user reads their ticket', async t => { t.view = await t.open(); }],
  ["the user finds Anjali's ticket in the shared queue", async t => { t.queue = (await t.read('queue')).tickets; assert.ok(t.queue.some(row => row.row_id === t.ticket.row_id)); t.view = await t.open(); }],
  ["the user attempts to change Anjali's requested scope", t => t.action('edit', { details: { ...t.details, scope: 'Bronze' } }, t.actor, true)],
  ['the user begins investigation without source or report evidence', async t => { t.view = await t.open(); }],
  ['the user records a confirmed mismatch with expected 2 invoices from {string} and observed 0 from {string} for 2026-11-01, observed at 2026-11-03T09:00:00Z', (t, source, report) => t.action('evidence', { expected: `2 invoices from ${source}`, observed: `0 from ${report}`, reference: `${source}; ${report}`, observed_at: '2026-11-03T09:00:00Z', finding: 'confirmed_mismatch' })],
  ['the user adds an existing GitHub issue reference', t => t.action('link', { url: 'https://github.com/fictional-warehouse/demo/issues/37' })],
  ['the user resolves it with reason {string} and evidence {string}', (t, reason, reference) => t.action('resolve', { reason, reference })],
  ['the user reopens it because {string}', (t, reason) => t.action('reopen', { reason })],
  ['the user attempts to resolve it as an ordinary investigation', t => t.action('resolve', { reason: 'Ordinary resolution', reference: 'Not fulfillment' }, t.actor, true)],
  ['the user inspects connection status', t => t.connections()],
  ['the user inspects the support queue', async t => { t.queue = (await t.read('queue')).tickets; }],
  ['the user explicitly loads the development samples', t => t.loadSamples()],
]);

steps(Then, [
  ["support sees the requester by the name Anjali's own session shows, not by her person id", async t => {
    const own = (await t.read('session', {}, 'Anjali')).user.full_name;
    assert.ok(own && own !== t.ids.Anjali);
    assert.equal((await t.open('Support')).names[t.ticket.owner], own);
  }],
  ['the user receives a ticket reference', t => { assert.equal(typeof t.ticket.row_id, 'string'); assert.ok(t.ticket.row_id.length > 0); }],
  ['the request remains available after signing out and back in', async t => { await t.world.signOutAndBackIn('Anjali'); assert.equal((await t.open('Anjali')).ticket.row_id, t.ticket.row_id); }],
  ['the ticket retains that recipient and requested scope', t => t.includes(t.details.email, t.details.scope)],
  ['employment remains unverified', async t => { await t.action('decide', { decision: 'approved' }, 'Bala', true); await t.denied(); }],
  ['the ticket retains the location, period and requested format', t => t.includes('Palakkad', '2026-10-01', '2026-10-31', 'Excel')],
  ['the ticket retains the source, affected report, date and expected invoices', t => t.includes('Zakya', 'daily sales', '2026-11-01', 'cleared invoices')],
  ['it does not invent a confirmed root cause', t => t.excludes('confirmed_root_cause')],
  ['the ticket retains the source, requested data and refresh need', t => t.includes('vendor API', 'daily stock movements', 'hourly')],
  ['the ticket is an access request with that scope', async t => { assert.equal((await t.open()).ticket.kind, 'access'); await t.includes(t.details.scope); }],
  ['its original message is still {string}', (t, original) => t.includes(original)],
  ['the matching ticket is available', t => assert.ok(t.queue.some(row => row.row_id === t.ticket.row_id))],
  ['the rename is refused and the original reference still opens its private request for Anjali', t => t.retainedReference()],
  ['deletion is refused and the evidence remains attributed in support history', t => t.retainedEvidence()],
  ["Anjali's ticket is included and the colleague's report ticket is excluded", t => { assert.ok(t.queue.some(row => row.row_id === t.assigned.row_id)); assert.ok(!t.queue.some(row => row.row_id === t.unrelated.row_id)); }],
  ['the public progress is available and the support-only note is not disclosed', t => t.publicPrivacy(true)],
  ['its summary and public progress are available', t => { assert.equal(t.view.ticket.row_id, t.ticket.row_id); assert.ok(JSON.stringify(t.view).includes('Support is checking this request')); }],
  ['the original request details and employee-verification evidence are not disclosed', t => t.publicPrivacy()],
  ['the edit is refused and the requested scope is unchanged', async t => { await t.denied(); assert.ok((await t.text('Anjali')).includes('Gold sales, read only')); }],
  ['the complaint remains unconfirmed', async t => { await t.excludes('confirmed_mismatch'); await t.includes('Invoices cleared two days ago'); }],
  ['no automated diagnosis or warehouse query is claimed', t => t.excludes('"query_executed":true', '"automated_diagnosis":true')],
  ['reopening the ticket shows that finding, both evidence references, observation time and author', t => t.includes('confirmed_mismatch', 'source-check-1', 'report-check-1', '2026-11-03T09:00:00', t.ids.Support)],
  ["the finding's root cause remains unknown", async t => assert.doesNotMatch(await t.text(), /"root_cause":"(?!unknown)[^"]+"/)],
  ["the reference is available in the ticket's support history", t => t.includes('/issues/37')],
  ['the ticket does not claim that an agent created an issue or pull request', t => t.excludes('"agent_created":true', '"agent_execution":true')],
  ['reopening the ticket shows the resolution, reason, evidence and responsible user', async t => { assert.equal(t.ticket.ticket_state, 'Resolved'); await t.includes('Report refreshed and both invoices present', 'report-check-2', t.ids.Support); }],
  ['the ticket returns to active work', t => assert.notEqual(t.ticket.ticket_state, 'Resolved')],
  ['its earlier resolution, evidence and reopening reason remain attributed in history', t => t.includes('Report refreshed and both invoices present', 'report-check-2', "The next day's report is still missing invoices", t.ids.Support)],
  ['resolution is refused and the request remains unfulfilled', async t => { await t.denied(); await t.unfulfilled(); }],
  ['employee lookup, inbound email and automated investigation are shown as unconfigured', t => { const text = JSON.stringify(t.connectionStatus); for (const name of ['employee', 'email', 'investigation', 'unconfigured']) assert.ok(text.includes(name)); }],
  ['no received email, employee match or agent execution is claimed', t => assert.doesNotMatch(JSON.stringify(t.connectionStatus), /"(?:received|matched|executed)":true/)],
  ['no sample tickets or fictional investigation findings are present', t => { assert.ok(!JSON.stringify(t.queue).match(/fictional|sample/i)); }],
  ['fictional tickets are available for the walkthrough', t => { assert.ok(t.queue.length > t.beforeQueue.length); assert.match(JSON.stringify(t.queue), /fictional/i); }],
  ['their employee and investigation evidence is identified as fictional rather than production findings', t => t.fictionalEvidence()],
]);
