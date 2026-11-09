'use strict';

// #964: who support may assign a ticket to, apart from who has support rights.
// Tickets knows a person's name once they have acted in it, so each scenario's
// people act before the picker is read.
class TicketsAssignees {
  constructor(tickets) { this.t = tickets; }
  async list(names) {
    await this.t.setup();
    await this.t.configure({ assignees: names.map(name => this.t.ids[name]) });
    await this.t.action('create', { title: 'Colleague files one', original: 'Colleague files one', kind: 'generic', details: {} }, 'Colleague');
    await this.t.create('generic', {}, 'The dashboard is late');
    await this.t.action('edit', { public_update: 'Checking' }, 'Support');
  }
  // #1097: listed, but they have not acted in Tickets yet.
  async listBeforeUse(names) {
    await this.t.setup();
    await this.t.configure({ assignees: names.map(name => this.t.ids[name]) });
  }
  async assign(name) { await this.t.action('edit', { assigned_to: this.t.ids[name] }, 'Support'); }
  async offered() { return (await this.t.read('session', {}, 'Support')).people.map(person => person.row_id); }
  async session(name) { return this.t.read('session', {}, name); }
}

module.exports = { TicketsAssignees };
