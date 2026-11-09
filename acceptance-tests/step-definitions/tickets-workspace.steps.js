'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { Tickets } = require('../support/pages/tickets');
const { AppTheme } = require('../support/pages/app-theme');
const { TicketsWorkspace, TASKER } = require('../support/pages/tickets-workspace');

// #941: Tickets in the platform shell (tickets-workspace) and app accents
// (trusted-runtime-packages). Exact spec sentences only.
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
// The shared bar's theme switch is one step for every app (app-theme.steps.js).
const opened = async (w, world, path, who) => { const page = await w.open(path, who); world.appTheme = new AppTheme(page); };

steps(Given, [
  ['Tickets names the green accent', async w => { TicketsWorkspace.ticketsNamesGreen(); await w.t.choose('Support'); }],
  ['Tasker names no accent', async w => { TicketsWorkspace.taskerNamesNone(); await w.installTasker(); }],
  ['an app names an accent that Featherbase does not provide', w => w.unknownAccentApp()],
]);

steps(When, [
  ['the user opens Tickets', (w, world) => opened(w, world)],
  ['the user opens Tasker', (w, world) => opened(w, world, TASKER, null)],
  ['a System Manager installs that app', w => w.install()],
]);

steps(Then, [
  ["Tickets' main buttons and its selected view in the shared navigation are green", w => w.expectAccent('light')],
  ["they are the dark theme's green", w => w.expectAccent('dark')],
  ["Tasker's selected view in the shared navigation is Featherbase's own blue", w => w.expectOwnBlue()],
  ['the installation is refused and names the accents Featherbase provides', w => w.expectRefusedNamingAccents()],
]);
