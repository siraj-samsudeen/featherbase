'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { BASE_URL } = require('../stack');

// #941: Tickets inside the platform shell. Selectors and
// addresses for the shared navigation (`<featherbase-sidebar>`, the app's
// light-DOM rows), the shared bar (`<featherbase-bar>`, a shadow root) and
// Tickets' own page live here; steps only call these methods.
const TICKETS = '/tickets/';
const SIDEBAR = 'featherbase-sidebar';
const BAR = 'featherbase-bar';
const BAR_THEME_ROOT = '[data-testid=bar-theme-root]';
const SETTINGS_LINK = /\/featherbase\/admin\/table\/app-setting/;
const SHORT = 10_000;

async function until(read, done, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    value = await read();
  }
  return value;
}

/** Text of the app's own light DOM: the shared bar and navigation left out. */
function ownText(page) {
  return page.evaluate(([bar, sidebar]) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => node.nodeType === 1
        ? (node.matches(`${bar}, ${sidebar}, script, style`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
        : NodeFilter.FILTER_ACCEPT,
    });
    const parts = [];
    while (walker.nextNode()) parts.push(walker.currentNode.textContent);
    return parts.join(' ').replace(/\s+/g, ' ');
  }, [BAR, SIDEBAR]);
}

class TicketsWorkspace {
  constructor(tickets) { this.t = tickets; this.tag = randomUUID().slice(0, 6); }

  get world() { return this.t.world; }

  // ---- arrangement (HTTP, through Tickets' own actions) ----

  async ticket(kind, title, details, assignee) {
    await this.t.create(kind, details, title);
    if (assignee) await this.t.action('edit', { assigned_to: this.t.ids[assignee] }, 'Support');
    return { ...this.t.ticket, title };
  }

  async supportWithAssignedWork() {
    await this.t.choose('Support');
    this.mine = await this.ticket('access', `Assigned access ${this.tag}`, { email: 'anjali@example.com', scope: 'Gold sales, read only' }, 'Support');
    this.theirs = await this.ticket('report', `Colleague report ${this.tag}`, { format: 'Excel' }, 'Bala');
  }

  async accessAndDataQuality() {
    await this.t.choose('Support');
    this.access = await this.ticket('access', `Access in queue ${this.tag}`, { email: 'anjali@example.com', scope: 'Gold sales, read only' });
    if (!this.world.ticketTypes) {
      const { TicketTypes } = require('./tickets');
      this.world.ticketTypes = new TicketTypes(this.t);
    }
    const types = this.world.ticketTypes;
    await types.configure();
    const title = `Data quality in queue ${this.tag}`;
    await this.t.action('create', { title, original: title, kind: types.key, details: { urgency: 'Now' } }, 'Anjali');
    this.dataQuality = { ...this.t.ticket, title };
  }

  async newAccessTicket() {
    await this.t.choose('Support');
    this.selected = await this.ticket('access', `New access ${this.tag}`, { email: 'anjali@example.com', scope: 'Gold sales, read only' });
  }

  async noConnections() { await this.t.choose('Support'); }

  // ---- the browser ----

  async open(path = TICKETS, who = this.t.actor) {
    this.page = who ? await this.world.signedIn(who) : await this.world.asSystemManager();
    await this.page.goto(`${BASE_URL}${path}`);
    await this.page.locator(`${BAR} ${BAR_THEME_ROOT}`).waitFor();
    if (path === TICKETS) await this.page.getByRole('button', { name: /New ticket/ }).first().waitFor();
    return this.page;
  }

  async ensureOpen() { if (!this.page) await this.open(); }

  sidebar() { return this.page.locator(SIDEBAR); }

  async sidebarPresent() {
    await this.sidebar().waitFor({ state: 'attached', timeout: SHORT }).catch(() => {
      throw new Error(`the page draws no shared app navigation (<${SIDEBAR}>)`);
    });
  }

  navRow(name) { return this.sidebar().locator(':scope > :is(button, a)', { hasText: name }).first(); }

  async expectViewsInNavigation() {
    await this.sidebarPresent();
    for (const view of [/^\s*All tickets/, /^\s*My requests/, /^\s*Assigned to me/])
      await this.navRow(view).waitFor({ timeout: SHORT }).catch(() => { throw new Error(`the shared navigation does not list the view ${view}`); });
  }

  async expectNoOwnChrome() {
    const own = await this.page.evaluate(([bar, sidebar]) =>
      [...document.querySelectorAll('nav, [role=navigation], aside')]
        .filter(el => !el.closest(`${bar}, ${sidebar}`))
        .map(el => el.outerHTML.slice(0, 80)), [BAR, SIDEBAR]);
    assert.deepEqual(own, [], 'Tickets draws navigation of its own');
    assert.doesNotMatch(await ownText(this.page), /Signed in|Sign out|Support workspace|Requester workspace/,
      'Tickets draws account controls of its own');
  }

  async chooseInNavigation(name) {
    await this.sidebarPresent();
    await this.navRow(name).click({ timeout: SHORT });
  }

  queueRow(title) { return this.page.locator('main').locator(':is(button, a)', { hasText: title }); }

  async expectQueue(shown, hidden) {
    await this.queueRow(shown.title).first().waitFor({ timeout: 10_000 });
    const left = await until(() => this.queueRow(hidden.title).count(), count => count === 0);
    assert.equal(left, 0, `the queue still shows "${hidden.title}"`);
  }

  async select(ticket) {
    await this.queueRow(ticket.title).first().click();
    await this.page.getByRole('heading', { name: ticket.title }).first().waitFor();
  }

  /** The ticket's header: the nearest box around its title that names its assignee. */
  async header(title) {
    return this.page.evaluate(([title, bar, sidebar]) => {
      const heading = [...document.querySelectorAll('main :is(h1, h2, h3)')].find(h => h.textContent.trim() === title && !h.closest(`${bar}, ${sidebar}`));
      if (!heading) return null;
      let box = heading.parentElement;
      while (box && box.tagName !== 'MAIN' && !/Assigned to/.test(box.textContent)) box = box.parentElement;
      const found = box && box.tagName !== 'MAIN' && /Assigned to/.test(box.textContent);
      const actions = found ? [...box.querySelectorAll('button')]
        .filter(b => b.getAttribute('role') !== 'tab' && !b.closest('[role=tablist]') && !b.disabled)
        .map(b => b.textContent.trim()) : [];
      return { titleTop: heading.getBoundingClientRect().top, text: found ? box.textContent : '', named: !!found, actions };
    }, [title, BAR, SIDEBAR]);
  }

  async expectHeaderAtTop() {
    const header = await this.header(this.selected.title);
    assert.ok(header, `no heading for "${this.selected.title}"`);
    assert.ok(header.named, 'the ticket header does not show who it is assigned to ("Assigned to")');
    assert.match(header.text, new RegExp(this.selected.ticket_state, 'i'), `the header does not show the state ${this.selected.ticket_state}`);
    assert.ok(header.titleTop < 260, `the ticket's title starts ${Math.round(header.titleTop)}px down the page, below other content`);
  }

  async expectActionsBeside() {
    const header = await this.header(this.selected.title);
    assert.ok(header?.named, 'the ticket has no header naming its assignee');
    assert.ok(header.actions.length > 0, 'no action is offered beside the ticket title, state and assignee');
  }

  async expectConnectionStatus() {
    await this.sidebarPresent();
    const status = this.sidebar().getByText(/not set up/i).first();
    await status.waitFor({ timeout: SHORT }).catch(() => { throw new Error('the shared navigation shows no "not set up" connection status'); });
    assert.ok((await status.innerText()).trim().length <= 80, 'the connection status is not short');
  }

  async statusLinks() {
    await this.sidebar().getByText(/not set up/i).first().waitFor({ timeout: SHORT });
    return this.sidebar().locator('a').evaluateAll(links => links.map(a => a.getAttribute('href') ?? ''));
  }
  async expectStatusLeadsToSettings() {
    const hrefs = await this.statusLinks();
    assert.ok(hrefs.some(href => SETTINGS_LINK.test(href)), `the status leads nowhere near Tickets' settings: ${JSON.stringify(hrefs)}`);
  }
  async expectStatusLeadsNowhere() {
    assert.deepEqual(await this.statusLinks(), [], 'the status offers a link this person cannot open');
  }

  async expectNoConnectionsBanner() {
    assert.doesNotMatch(await ownText(this.page), /Connections|Unconfigured|not set up|Employee lookup|Inbound email/i,
      'a connections banner is shown on the page');
  }
}

module.exports = { TicketsWorkspace };
