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
  ["Anjali's missing-invoice ticket has a recorded mismatch", async t => { await t.complaint(); await t.finding(); }],
]);

steps(When, [
  ['the user submits {string} as a free-text request', (t, text) => t.create('generic', {}, text)],
  ["the user attempts to rename Anjali's ticket", t => t.renameTicket()],
  ['Administrator attempts to delete its evidence using the current revision', t => t.deleteEvidence()],
]);

steps(Then, [
  ["support sees the requester by the name Anjali's own session shows, not by her person id", async t => {
    const own = (await t.read('session', {}, 'Anjali')).user.full_name;
    assert.ok(own && own !== t.ids.Anjali);
    assert.equal((await t.open('Support')).names[t.ticket.owner], own);
  }],
  ['the rename is refused and the original reference still opens its private request for Anjali', t => t.retainedReference()],
  ['deletion is refused and the evidence remains attributed in support history', t => t.retainedEvidence()],
]);
