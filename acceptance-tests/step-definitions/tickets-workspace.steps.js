'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { TicketsWorkspace } = require('../support/pages/tickets-workspace');

// #941: Tickets in the platform shell (tickets-workspace). Exact spec
// sentences only.
const flow = world => {
  world.tickets ??= new Tickets(world);
  return (world.workspace ??= new TicketsWorkspace(world.tickets));
};
const steps = (keyword, definitions) => {
  for (const [sentence, run] of definitions) {
    const invoke = async function (...args) { return run(flow(this), this, ...args); };
    Object.defineProperty(invoke, 'length', { value: Math.max(0, run.length - 2) });
    keyword(sentence, invoke);
  }
};
const opened = (w, world, path, who) => w.open(path, who);

steps(Given, [
  ['the user is support staff with tickets assigned to them', w => w.supportWithAssignedWork()],
  ['the queue holds an access request and a data quality issue', w => w.accessAndDataQuality()],
  ['the user is support staff and a new access ticket waits in the queue', w => w.newAccessTicket()],
  ["none of Tickets' outside connections is set up", w => w.noConnections()],
]);

steps(When, [
  ['the user opens Tickets', (w, world) => opened(w, world)],
  ['the user chooses the view of tickets assigned to them', w => w.chooseInNavigation(/^\s*Assigned to me/)],
  ['the user chooses the access request type in the shared app navigation', async w => { await w.ensureOpen(); await w.chooseInNavigation(/^\s*Access/); }],
  ['the user opens Tickets and selects that ticket', async (w, world) => { await opened(w, world); await w.select(w.selected); }],
  ['a System Manager opens Tickets', (w, world) => opened(w, world, undefined, null)],
]);

steps(Then, [
  ["Tickets' views are listed in the shared app navigation", w => w.expectViewsInNavigation()],
  ['Tickets shows no navigation or account controls of its own', w => w.expectNoOwnChrome()],
  ['the queue shows only the tickets assigned to the user', w => w.expectQueue(w.mine, w.theirs)],
  ['the queue shows the access request and not the data quality issue', w => w.expectQueue(w.access, w.dataQuality)],
  ["the ticket's title, state and assignee are shown at the top of the page", w => w.expectHeaderAtTop()],
  ['the actions the user can take on it now are offered beside them', w => w.expectActionsBeside()],
  ['a short status in the navigation says the connections are not set up', w => w.expectConnectionStatus()],
  ['no connections banner is shown above the queue', w => w.expectNoConnectionsBanner()],
  ["the status leads to Tickets' settings", w => w.expectStatusLeadsToSettings()],
  ['the status leads nowhere', w => w.expectStatusLeadsNowhere()],
]);
