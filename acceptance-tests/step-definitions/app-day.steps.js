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

Given('today is {day}', async function (day) {
  if (/jeyarama-assets/.test(this.featureUri)) {
    this.today = Date.parse(`${day}T10:00:00+05:30`);
    return;
  }
  await TaskerSetup.of(this);
  // Midday UTC is the same calendar day for the server and any browser.
  await setAppClock(this, `${day}T12:00:00Z`);
});
