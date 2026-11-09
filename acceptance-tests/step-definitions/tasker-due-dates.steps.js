'use strict';

// openspec/changes/tasker-due-dates-and-stores/specs/tasker-due-dates: start
// and due dates, and seeing which tasks are late or scheduled.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TaskerSetup, taskerAs, taskerViewer } = require('../support/tasker');

/** A task with these dates: the scenario's own if it has one by that title, else a new one. */
async function dated(world, title, values) {
  const tasker = await TaskerSetup.of(world);
  await tasker.member('the user');
  return tasker.tasks.has(title) ? tasker.change(title, values) : tasker.task(title, values);
}

Given('the task {string} starts on {day}', async function (title, day) {
  await dated(this, title, { start_date: day });
});

Given('the task {string} is due on {day} and is not done', async function (title, day) {
  const task = await dated(this, title, { due_date: day });
  assert.notEqual(task.task_state, 'Done');
});

Given('the task {string} is due on {day}', async function (title, day) {
  await dated(this, title, { due_date: day });
});

Given('the task {string} is overdue', async function (title) {
  const tasker = await TaskerSetup.of(this);
  await dated(this, title, { due_date: tasker.daysFromToday(-2) });
});

Given('the task {string} is scheduled', async function (title) {
  const tasker = await TaskerSetup.of(this);
  await dated(this, title, { start_date: tasker.daysFromToday(4) });
});

When('the user sets its due date to {day}', async function (day) {
  const task = this.tasker.current;
  const page = await taskerAs(this, 'the user');
  await page.openTask(task.row_id, task.task_title);
  await page.saving(() => page.setDueDate(day));
  this.taskerPage = page;
});

Then('the task shows it is due on {day}', async function (day) {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openTask(task.row_id, task.task_title);
  assert.equal(await page.dueDate(), day);
});

Then("the due date is refused, saying it can't be before the start date", async function () {
  const task = this.tasker.current;
  assert.match(await this.taskerPage.refusal(), /due date can[’']t be before the start date/i);
  const page = await taskerViewer(this);
  await page.openTask(task.row_id, task.task_title);
  assert.equal(await page.dueDate(), '', 'the refused due date was kept');
});

Then('the task is marked Overdue', async function () {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf(task));
  await page.expectDueMark(task.task_title, 'overdue');
  assert.match((await page.dueMark(task.task_title)).text, /^Overdue\b/);
});

Then('the task is marked Scheduled', async function () {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf(task));
  await page.expectDueMark(task.task_title, 'scheduled');
  assert.match((await page.dueMark(task.task_title)).text, /^Scheduled\b/);
});

When('the user marks it done', async function () {
  const task = this.tasker.current;
  const page = await taskerAs(this, 'the user');
  await page.openProject(this.tasker.projectOf(task));
  await page.tickDone(task.task_title);
});

Then('the task is not marked Overdue', async function () {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf(task));
  await page.expectDone(task.task_title);
  const mark = await page.dueMark(task.task_title);
  assert.notEqual(mark?.mark, 'overdue', `the finished task is marked ${mark?.text}`);
});

When('the user narrows the list to overdue tasks', async function () {
  const page = await taskerAs(this, 'the user');
  await page.openProject(this.tasker.projectOf());
  await page.narrow('Due', 'Overdue');
  this.taskerPage = page;
});
