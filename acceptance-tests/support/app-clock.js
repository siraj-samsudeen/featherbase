'use strict';

// The app's clock for a scenario: "today is 6 November 2026", "at 10:00 next
// morning". It sets the time on both sides of the app at once: the server
// (server-clock.cjs, preloaded into the run's API) and every browser of the
// scenario, open now or later (Playwright's clock, applied in world.newPage).
// The clock stands still at that instant until the scenario moves it, and goes
// back to real time after the scenario.

const fs = require('node:fs');
const { After } = require('@cucumber/cucumber');
const { CLOCK_FILE } = require('./stack');
const { Api } = require('./api');

/** Sets the app's clock to this instant (a Date or an ISO string with its offset). */
async function setAppClock(world, instant) {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new Error(`not an instant: ${instant}`);
  // The run's System Manager session is signed in on real time, so it is
  // still valid when the clock goes back to it.
  await Api.asSystemManager();
  fs.writeFileSync(CLOCK_FILE, at.toISOString());
  world.appClock = at;
  for (const { context } of world.contexts) await context.clock.setFixedTime(at);
  return at;
}

/** The instant the app's clock shows: the scenario's, or the real time. */
function appNow(world) {
  return world.appClock ? new Date(world.appClock) : new Date();
}

After(function () {
  if (!this.appClock) return;
  fs.rmSync(CLOCK_FILE, { force: true });
  this.appClock = null;
});

module.exports = { setAppClock, appNow };
