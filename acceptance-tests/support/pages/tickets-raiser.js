'use strict';

const { BASE_URL, acceptanceSql } = require('../stack');

// #963: the change of raiser, as a System Manager's API action and as support
// reads it in the ticket's history.
class TicketsRaiser {
  constructor(transitions) { this.transitions = transitions; this.t = transitions.t; }
  async known(name, roles) {
    await this.t.world.person(name, roles);
    if (this.t.ids[name]) return;
    const page = await this.t.world.signedIn(name);
    await page.goto(`${BASE_URL}/tickets/`);
    this.t.ids[name] = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user')).row_id);
  }
  async disable(name) { await acceptanceSql('update featherbase.person set enabled = false where row_id = $1', [this.t.ids[name]]); }
  // A scenario's people have no names until given them; a person's name reaches Tickets when they act.
  async name(...people) {
    for (const person of people) {
      await acceptanceSql('update featherbase.person set full_name = $1 where row_id = $2', [person, this.t.ids[person]]);
      await acceptanceSql('update tickets.member set full_name = $1 where row_id = $2', [person, this.t.ids[person]]);
    }
  }
  async change(actor, person, reason) {
    if (actor === 'Manager') {
      await this.known('Manager', ['System Manager']);
      await this.name('Anjali', 'Colleague', 'Manager');
    }
    this.reason = reason;
    return this.t.action('change_raiser', { new_raiser: this.t.ids[person], reason }, actor, true);
  }
  async saveDirectly(actor, person) {
    await this.known(actor, ['System Manager']);
    this.t.last = await this.t.call(actor, '/api/save_row', { table: 'tickets.ticket', row: { ...this.t.revision(), owner: this.t.ids[person] } });
  }
  async openActivity(actor) {
    const page = await this.transitions.types.page(actor);
    await page.getByLabel('Search tickets').fill(this.t.ticket.row_id);
    await page.locator('.ticket-id', { hasText: this.t.ticket.row_id }).first().click();
    await page.locator('.ticket-kicker').waitFor();
    await page.getByRole('tab', { name: 'Activity' }).click();
    this.page = page;
  }
  async historyReads() {
    const event = this.page.locator('.event').filter({ hasText: 'Change Raiser' });
    await event.waitFor();
    const text = await event.innerText();
    for (const expected of ['Old Raiser', 'New Raiser', 'Anjali', 'Colleague', 'Manager', this.reason]) if (!text.includes(expected)) throw new Error(`"${expected}" missing from: ${text}`);
    for (const id of [this.t.ids.Anjali, this.t.ids.Colleague, this.t.ids.Manager]) if (text.includes(id)) throw new Error(`A raw id is shown: ${text}`);
  }
}

module.exports = { TicketsRaiser };
