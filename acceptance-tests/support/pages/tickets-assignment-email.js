'use strict';

const { acceptanceSql } = require('../stack');

// #1001: what Tickets queued, read from the Email Queue. Nothing here sends:
// the acceptance stack has no SMTP server.
class TicketsAssignmentEmail {
  constructor(tickets) {
    this.t = tickets;
    this.title = 'The dashboard is late';
    this.description = 'Invoices cleared two days ago are missing';
  }
  async raise() {
    await this.t.setup();
    this.t.actor = 'Anjali';
    this.t.ticket = (await this.t.action('create', { title: this.title, original: this.description, kind: 'generic', details: {} }, 'Anjali')).ticket;
  }
  async assign(name) {
    await this.t.action('edit', { assigned_to: this.t.ids[name] }, 'Support');
    this.assignee = name;
  }
  async mail() {
    const rows = await acceptanceSql(`select recipient, body from email_queue where ref_table = 'tickets.ticket' and reference_name = '${this.t.ticket.row_id}'`);
    return rows;
  }
  async mailTo(name) {
    const [person] = await acceptanceSql(`select email from person where row_id = '${this.t.ids[name]}'`);
    return (await this.mail()).filter(row => row.recipient === person.email);
  }
}

module.exports = { TicketsAssignmentEmail };
