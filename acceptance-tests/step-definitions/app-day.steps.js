'use strict';

// "Today is 6 November 2026": one step, since Tasker's and Assets' scenarios
// say it the same way, but each app takes the day differently.
// - Tasker marks tasks Overdue or Scheduled by the app's clock, so its
//   scenarios set the clock of the server and every browser.
// - Assets' register reads the day in the browser of whoever opens it, so its
//   scenarios keep the day (10:00 in India) for that browser.

const { Before, Given } = require('@cucumber/cucumber');
const { TaskerSetup } = require('../support/tasker');
const { setAppClock } = require('../support/app-clock');

Before(function ({ pickle }) { this.featureUri = pickle.uri; });

// Which app a scenario is in, by its spec's name (asset-register, tasker-due-dates).
// The spec moves when its change is archived, so the name is what to go by.
Given('today is {day}', async function (day) {
  const spec = this.featureUri.match(/([^/]+)\/spec\.feature$/)?.[1] ?? this.featureUri;
  if (/^asset-/.test(spec)) {
    this.today = Date.parse(`${day}T10:00:00+05:30`);
    return;
  }
  if (!/^tasker-/.test(spec)) throw new Error(`"today is" doesn't know how to set the day for the spec ${spec}`);
  await TaskerSetup.of(this);
  // Midday UTC is the same calendar day for the server and any browser.
  await setAppClock(this, `${day}T12:00:00Z`);
});
