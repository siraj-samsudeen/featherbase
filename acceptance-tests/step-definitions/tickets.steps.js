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
  ["the user attempts to rename Anjali's ticket", t => t.renameTicket()],
  ['Administrator attempts to delete its evidence using the current revision', t => t.deleteEvidence()],
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
  ['the rename is refused and the original reference still opens its private request for Anjali', t => t.retainedReference()],
  ['deletion is refused and the evidence remains attributed in support history', t => t.retainedEvidence()],
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
