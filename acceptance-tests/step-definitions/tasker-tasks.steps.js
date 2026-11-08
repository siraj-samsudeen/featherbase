'use strict';

// Steps every Tasker capability shares: the app's day, the user's task, what a
// task shows in its list, and what a list shows.

const { Given, Then, After } = require('@cucumber/cucumber');
const { TaskerSetup, taskerViewer } = require('../support/tasker');
const { setAppClock } = require('../support/app-clock');

After(async function () { await this.tasker?.dispose(); });

Given('today is {day}', async function (day) {
  await TaskerSetup.of(this);
  // Midday UTC is the same calendar day for the server and any browser.
  await setAppClock(this, `${day}T12:00:00Z`);
});

Given('the user has a task {string}', async function (title) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member('the user');
  await tasker.task(title);
});

Then('the task shows {string}', async function (text) {
  const tasker = await TaskerSetup.of(this);
  const page = await taskerViewer(this);
  await page.openProject(tasker.projectOf());
  await page.expectRowShows(tasker.current.task_title, text);
});

Then('the list shows {string}', async function (title) {
  await this.taskerPage.expectListed(title);
});

Then('the list does not show {string}', async function (title) {
  await this.taskerPage.expectNotListed(title);
});
