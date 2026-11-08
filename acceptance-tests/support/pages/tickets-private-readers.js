'use strict';

const assert = require('node:assert/strict');
const { BASE_URL } = require('../stack');

// #925: a private ticket's assignee and the person it is raised for read it.
class TicketsPrivateReaders {
  constructor(transitions) { this.transitions = transitions; this.t = transitions.t; }
  async known(name) {
    await this.t.world.person(name, ['All']);
    if (this.t.ids[name]) return;
    const page = await this.t.world.signedIn(name);
    await page.goto(`${BASE_URL}/tickets/`);
    this.t.ids[name] = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
  }
  async raise(raiser, raisedFor, assignee) {
    await this.transitions.configure();
    // The raiser names the person it is raised for, so may see people.
    await this.transitions.types.reader(raiser);
    for (const name of [raisedFor, 'Meera']) await this.known(name);
    await this.transitions.types.submit({ urgency: 'Now', source_system: this.transitions.types.systems.SAP, current_value: '78/499/1',
      raised_for: this.t.ids[raisedFor] }, raiser);
    await this.assign(assignee);
  }
  assign(name) { return this.t.action('edit', { assigned_to: this.t.ids[name] }, 'Support'); }
  async reads(name) {
    const seen = await this.t.open(name);
    assert.equal(seen.details?.current_value, '78/499/1', `${name} reads the details`);
    return seen;
  }
  async readsNot(name) {
    const seen = await this.t.open(name);
    assert.equal(seen.details, undefined, `${name} does not read the details`);
    assert.ok(!JSON.stringify(seen).includes('78/499/1'));
  }
}

module.exports = { TicketsPrivateReaders };
