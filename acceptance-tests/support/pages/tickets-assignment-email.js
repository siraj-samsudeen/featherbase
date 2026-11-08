'use strict';

const { randomUUID } = require('node:crypto');
const { acceptanceSql, BASE_URL } = require('../stack');

const until = async (check, tries = 50) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('The email was not queued');
};

// #1001: what Tickets queued, read from the Email Queue. Nothing here sends:
// the acceptance stack has no SMTP server.
class TicketsAssignmentEmail {
  constructor(tickets) {
    this.t = tickets;
    this.title = `The dashboard is late ${randomUUID().slice(0, 8)}`;
    this.description = 'Invoices cleared two days ago are missing';
  }
  async raise() {
    await this.t.setup();
    this.t.actor = 'Anjali';
    await this.t.action('create', { title: this.title, original: this.description, kind: 'generic', details: {} }, 'Anjali');
  }
  async assign(name) {
    await this.t.action('edit', { assigned_to: this.t.ids[name] }, 'Support');
    this.assignee = name;
  }
  async assignable(name) {
    await this.t.configure({ assignees: [this.t.ids[name]] });
    // Tickets knows a person's name once they have acted in it.
    const raised = this.t.ticket;
    await this.t.action('create', { title: `${name} files one`, original: `${name} files one`, kind: 'generic', details: {} }, name);
    this.t.ticket = raised;
  }
  async assignOnScreen(name) {
    const page = await this.t.world.signedIn('Support');
    await page.goto(`${BASE_URL}/tickets/?ticket=${this.t.ticket.row_id}`);
    await page.getByRole('heading', { name: this.title }).first().waitFor();
    await page.getByRole('button', { name: 'Edit request' }).first().click();
    await page.locator('select[name="assigned_to"]').selectOption(this.t.ids[name]);
    await page.getByRole('button', { name: 'Save request' }).click();
    await until(async () => (await this.mail()).length > 0);
  }
  async followLink(name) {
    const [{ body }] = await this.mailTo(name);
    const link = new URL(/Open it here: (\S+)/.exec(body)[1]);
    const page = await this.t.world.signedIn(name);
    await page.goto(`${BASE_URL}${link.pathname}${link.search}`);
    // After the queue has loaded, and it isn't the first ticket in it: the link chose it.
    await page.getByText('Loading queue').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: this.title }).first().waitFor();
  }
  async mail() {
    return [...await acceptanceSql(`select recipient, body from featherbase.email_queue where ref_table = 'tickets.ticket' and reference_name = $1`, [this.t.ticket.row_id])];
  }
  async mailTo(name) {
    const [person] = await acceptanceSql(`select email from featherbase.person where row_id = $1`, [this.t.ids[name]]);
    return (await this.mail()).filter(row => row.recipient === person.email);
  }
}

module.exports = { TicketsAssignmentEmail };
