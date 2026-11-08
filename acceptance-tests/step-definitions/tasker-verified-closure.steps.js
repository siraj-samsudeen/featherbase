'use strict';

// openspec/changes/tasker-verified-closure/specs/tasker-verified-closure:
// verifiers, acknowledgement, submit/accept/return, moving a due date and
// cancelling only with a reason.
//
// Where Tasker's screens don't offer a refused change at all (a disabled Done
// box, a reason form that can't be confirmed empty, an assignee left out of the
// verifier choices), the step tries it in the browser and also sends the same
// change to the server as that member, so the refusal is the app's, not only
// the screen's.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TaskerSetup, taskerAs, taskerViewer } = require('../support/tasker');

const SUBMITTED = 'Submitted for verification';
const DUE_REASON = ['Reason for moving the due date', 'Move due date'];
const CANCEL_REASON = ['Reason for cancelling', 'Cancel task'];

/** A shared task in a project, assigned and verified as the scenario says. */
async function sharedTask(world, title, { assignee, verifier, ...values } = {}) {
  const tasker = await TaskerSetup.of(world);
  return tasker.task(title, {
    ...(assignee ? { assigned_to: (await tasker.member(assignee)).id } : {}),
    ...(verifier ? { verifier: (await tasker.member(verifier)).id } : {}),
    ...values,
  });
}

/** The current task, opened in its details by this member. */
async function openedBy(world, who) {
  const task = world.tasker.current;
  const page = await taskerAs(world, who);
  await page.openTask(task.row_id, task.task_title);
  return page;
}

Given('the project {string} has {member} as its default verifier', async function (name, verifier) {
  const tasker = await TaskerSetup.of(this);
  await tasker.project(name, { default_verifier: (await tasker.member(verifier)).id });
  this.project = name;
});

When('{member} adds the task {string} to it', async function (who, title) {
  const page = await taskerAs(this, who);
  await page.openProject(this.project);
  await page.addTaskToProject(title);
  await this.tasker.findTask(title);
});

Then("the task's verifier is {member}", async function (verifier) {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openTask(task.row_id, task.task_title);
  assert.equal(await page.chosenVerifier(), verifier);
});

Given('the task {string} is assigned to {member}', async function (title, assignee) {
  await sharedTask(this, title, { assignee });
});

When('someone makes {member} its verifier', async function (verifier) {
  const tasker = this.tasker;
  const { id } = await tasker.member(verifier);
  const page = await openedBy(this, 'a member');
  this.offered = await page.verifiersOffered();
  this.answer = await tasker.attempt('tasker.task', { row_id: tasker.current.row_id, verifier: id }, await tasker.as('a member'));
});

Then("the change is refused, saying the verifier can't be the person doing the task", async function () {
  const tasker = this.tasker;
  const assignee = (await tasker.fresh()).assigned_to;
  assert.ok(!this.offered.includes(assignee), 'the assignee is offered as the verifier');
  assert.equal(this.answer.ok, false, 'the server accepted the assignee as verifier');
  assert.match(this.answer.message, /verifier can[’']t be the person doing the task/);
  assert.equal((await tasker.fresh()).verifier, null);
});

Given('{member} assigns {string} to {member}', async function (who, title, assignee) {
  const tasker = await TaskerSetup.of(this);
  await sharedTask(this, title);
  const { id } = await tasker.member(assignee);
  const page = await openedBy(this, who);
  await page.assignTo(id);
  assert.equal((await tasker.fresh()).assigned_to, id);
});

When('{member} acknowledges it', async function (who) {
  const page = await openedBy(this, who);
  await page.acknowledge();
});

Then('the task no longer shows it is not acknowledged', async function () {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf());
  await page.expectRowLacks(task.task_title, 'Not acknowledged by');
});

Given('{string} is assigned to {member} and {member} verifies it', async function (title, assignee, verifier) {
  await sharedTask(this, title, { assignee, verifier });
});

When('{member} marks it Done', async function (who) {
  const tasker = this.tasker;
  const task = tasker.current;
  const page = await taskerAs(this, who);
  await page.openProject(tasker.projectOf());
  this.doneBox = await page.doneBoxState(task.task_title);
  if (this.doneBox.enabled) await page.tickDone(task.task_title);
  this.answer = await tasker.attempt('tasker.task', { row_id: task.row_id, is_done: true }, await tasker.as(who));
});

Then('it is refused, saying to submit it for verification', async function () {
  assert.equal(this.doneBox.enabled, false, 'the Done box could be ticked');
  assert.match(this.doneBox.says, /Submit it from the task details/);
  assert.equal(this.answer.ok, false, 'the server marked it Done');
  assert.match(this.answer.message, /Submit this task for verification/);
  assert.notEqual((await this.tasker.fresh()).task_state, 'Done');
});

When('{member} submits it with the note {string}', async function (who, note) {
  const page = await openedBy(this, who);
  await page.saving(() => page.submitForVerification(note));
  await page.expectSubmitted();
});

Then('it shows {string}', async function (text) {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf());
  await page.expectRowShows(task.task_title, text);
});

Then('it is on {member}\'s "To verify" page', async function (who) {
  const page = await taskerAs(this, who);
  await page.openToVerify();
  await page.expectToVerify(this.tasker.current.task_title);
});

When('{member} accepts it', async function (who) {
  const page = await taskerAs(this, who);
  await page.openToVerify();
  await page.openFromToVerify(this.tasker.current.task_title);
  await page.acceptVerification();
});

Then('it is Done, verified by {member}', async function (verifier) {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf());
  await page.expectRowShows(task.task_title, `Verified by ${verifier}`);
  assert.equal(await page.rowState(task.task_title), 'Done');
});

Given('{string} has a verifier', async function (title) {
  await sharedTask(this, title, { assignee: 'Ravi', verifier: 'Meena' });
});

When('{member} submits it without a note', async function (who) {
  const page = await openedBy(this, who);
  await page.saving(() => page.submitForVerification(''));
  this.taskerPage = page;
});

Then('it is refused, saying to add a note on what was done', async function () {
  assert.match(await this.taskerPage.refusal(), /Add a note on what was done/);
  assert.notEqual((await this.tasker.fresh()).task_state, SUBMITTED);
});

Given('{member} submitted {string} for {member} to verify', async function (doer, title, verifier) {
  const tasker = await TaskerSetup.of(this);
  await sharedTask(this, title, { assignee: doer, verifier });
  const submitted = await tasker.change(title, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' }, await tasker.as(doer));
  assert.equal(submitted.task_state, SUBMITTED);
});

When('{member} returns it with the reason {string}', async function (who, reason) {
  const page = await taskerAs(this, who);
  await page.openToVerify();
  await page.openFromToVerify(this.tasker.current.task_title);
  await page.returnWithReason(reason);
});

Then('it is In progress and shows {string}', async function (text) {
  const task = this.tasker.current;
  const page = await taskerViewer(this);
  await page.openProject(this.tasker.projectOf());
  await page.expectRowShows(task.task_title, text);
  assert.equal(await page.rowState(task.task_title), 'In progress');
});

Then('it has been returned once', async function () {
  assert.equal((await this.tasker.fresh()).return_count, 1);
});

Given('{string} is due on {day}', async function (title, day) {
  await sharedTask(this, title, { assignee: 'Ravi', due_date: day });
});

When('{member} moves it to {day} without a reason', async function (who, day) {
  const tasker = this.tasker;
  const page = await openedBy(this, who);
  await page.setDueDate(day);
  this.reasonForm = await page.reasonAsked(...DUE_REASON);
  this.answer = await tasker.attempt('tasker.task', { row_id: tasker.current.row_id, due_date: day }, await tasker.as(who));
  this.dueBefore = tasker.current.due_date;
});

Then('it is refused, saying to give a reason', async function () {
  assert.deepEqual(this.reasonForm, { asked: DUE_REASON[0], value: '', canConfirm: false });
  assert.equal(this.answer.ok, false, 'the server moved the due date without a reason');
  assert.match(this.answer.message, /Give a reason for moving the due date/);
  assert.equal((await this.tasker.fresh()).due_date, this.dueBefore);
});

When('{member} moves it to {day} because {string}', async function (who, day, reason) {
  const page = await openedBy(this, who);
  await page.setDueDate(day);
  await page.saving(() => page.giveReason(...DUE_REASON, reason));
});

Given('the task {string}', async function (title) {
  await sharedTask(this, title);
});

When('someone cancels it without a reason', async function () {
  const tasker = this.tasker;
  const page = await openedBy(this, 'a member');
  await page.chooseCancelled();
  this.reasonForm = await page.reasonAsked(...CANCEL_REASON);
  this.answer = await tasker.attempt('tasker.task', { row_id: tasker.current.row_id, task_state: 'Cancelled' }, await tasker.as('a member'));
});

Then('it is refused, saying to give a reason for cancelling', async function () {
  assert.deepEqual(this.reasonForm, { asked: CANCEL_REASON[0], value: '', canConfirm: false });
  assert.equal(this.answer.ok, false, 'the server cancelled it without a reason');
  assert.match(this.answer.message, /Give a reason for cancelling/);
  assert.notEqual((await this.tasker.fresh()).task_state, 'Cancelled');
});
