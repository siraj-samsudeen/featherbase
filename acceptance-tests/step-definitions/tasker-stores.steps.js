'use strict';

// openspec/changes/tasker-due-dates-and-stores/specs/tasker-stores: the store
// list, a task's store, the store-wise summary and the Store filter.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TaskerSetup, taskerAs, taskerViewer } = require('../support/tasker');

Given('the store list has no {string}', async function (name) {
  const tasker = await TaskerSetup.of(this);
  assert.deepEqual(await tasker.storesNamed(name), []);
});

When('a member adds {string} as a store', async function (name) {
  const page = await taskerAs(this, 'a member');
  await page.openStores();
  await page.addStore(name, 'Store');
});

Then('every member can choose {string} for a task', async function (name) {
  const tasker = await TaskerSetup.of(this);
  for (const [who, title] of [['a member', 'Check the shelf labels'], ['another member', 'Count the trolleys']]) {
    const task = await tasker.task(title, { project: null }, await tasker.as(who));
    const page = await taskerAs(this, who);
    await page.openTask(task.row_id, title);
    assert.ok((await page.storesOffered()).includes(name), `${who} is not offered ${name}`);
  }
});

When('the user chooses {string} for it', async function (name) {
  const tasker = await TaskerSetup.of(this);
  await tasker.store(name);
  const task = tasker.current;
  const page = await taskerAs(this, 'the user');
  await page.openTask(task.row_id, task.task_title);
  await page.chooseStore(name);
});

Given('the task {string} belongs to {string}', async function (title, name) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member('the user');
  const store = await tasker.store(name);
  if (tasker.tasks.has(title)) await tasker.change(title, { store: store.row_id });
  else await tasker.task(title, { store: store.row_id });
});

When('the user adds the subtask {string}', async function (title) {
  const parent = this.tasker.current;
  const page = await taskerAs(this, 'the user');
  await page.openTask(parent.row_id, parent.task_title);
  await page.addSubtask(title);
  this.subtask = { parent, title };
});

Then('the subtask shows {string}', async function (name) {
  const { parent, title } = this.subtask;
  const page = await taskerViewer(this);
  await page.openTask(parent.row_id, parent.task_title);
  await page.openSubtask(title);
  assert.equal(await page.chosenStore(), name);
});

Given('{string} has one done task, one overdue task, one scheduled task and two other open tasks', async function (name) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member('the user');
  const store = (await tasker.store(name)).row_id;
  await tasker.task('Close the cash counter', { store, task_state: 'Done' });
  await tasker.task('Reconcile stock variance', { store, due_date: tasker.daysFromToday(-2) });
  await tasker.task('Diwali display change-over', { store, start_date: tasker.daysFromToday(4) });
  await tasker.task('Refill the billing rolls', { store });
  await tasker.task('Check the fire exits', { store });
  this.store = name;
});

Given('it has one cancelled task', async function () {
  const tasker = await TaskerSetup.of(this);
  const store = (await tasker.store(this.store)).row_id;
  await tasker.task('Dropped supplier visit', { store });
  const cancelled = await tasker.change('Dropped supplier visit', { task_state: 'Cancelled', change_reason: 'Supplier moved the visit online' });
  assert.equal(cancelled.task_state, 'Cancelled');
});

Then('its row shows Total {int}, Completed {int}, Overdue {int}, Scheduled {int} and Ongoing {int}',
  async function (total, completed, overdue, scheduled, ongoing) {
    const page = await taskerAs(this, 'the user');
    await page.openStores();
    assert.deepEqual(await page.storeCounts(this.store), { total, completed, overdue, scheduled, ongoing });
  });

Given('another member has a private task in {string}', async function (name) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member('the user');
  const store = (await tasker.store(name)).row_id;
  const task = await tasker.task('Recount the damaged stock', { project: null, store }, await tasker.as('another member'));
  assert.equal(task.shared, false);
  this.store = name;
});

Then("the user's {string} row does not count it", async function (name) {
  // The task is counted for the member whose task it is …
  const theirs = await taskerAs(this, 'another member');
  await theirs.openStores();
  assert.equal((await theirs.storeCounts(name)).total, 1);
  // … and not for the user.
  const page = await taskerAs(this, 'the user');
  await page.openStores();
  assert.equal((await page.storeCounts(name)).total, 0);
});

Given('{string} has the overdue task {string}', async function (name, title) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member('the user');
  const store = (await tasker.store(name)).row_id;
  // Late work in another store too, so the count has something to leave out.
  const elsewhere = (await tasker.store('Avadi Store')).row_id;
  await tasker.task('Count the cold room', { store: elsewhere, due_date: tasker.daysFromToday(-3) });
  await tasker.task(title, { store, due_date: tasker.daysFromToday(-3) });
  this.store = name;
});

When('the user opens its Overdue count', async function () {
  const page = await taskerAs(this, 'the user');
  await page.openStores();
  await page.openCount(this.store, 'Overdue');
  this.taskerPage = page;
});

Then('the user sees {string}', async function (title) {
  const tasks = await this.taskerPage.drilledTasks();
  assert.ok(tasks.some((task) => task.title === title), `${title} is not among ${JSON.stringify(tasks)}`);
});

Then('no task from another store', async function () {
  const tasks = await this.taskerPage.drilledTasks();
  assert.ok(tasks.length > 0);
  for (const task of tasks) assert.equal(task.store, this.store, `${task.title} is from ${task.store}`);
});

When('the user narrows the list to {string}', async function (name) {
  const page = await taskerAs(this, 'the user');
  await page.openProject(this.tasker.projectOf());
  await page.narrow('Store', name);
  this.taskerPage = page;
});
