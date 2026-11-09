'use strict';

// Tasker in the browser, for one signed-in member: its sidebar views, a
// project's task list and its filters, task details, the Stores summary, the
// To verify page and the Issues page. Steps never see a selector or a URL.

const SETTLE_MS = 30_000;

class TaskerPage {
  constructor(page) { this.page = page; }

  // --- getting around ---------------------------------------------------------

  /** Tasker's home, loaded fresh. */
  async open() {
    await this.page.goto('/tasker/');
    await this.page.getByTestId('task-management-page').waitFor();
    // Its tasks, stores and people arrive after the page: counts and lists
    // are read once they have.
    await this.page.waitForLoadState('networkidle');
  }

  sidebar() { return this.page.locator('featherbase-sidebar'); }

  /** Does `action` and waits until the change it sends to the server is answered. */
  async saving(action) {
    const answered = this.page.waitForResponse(
      (res) => ['PATCH', 'POST'].includes(res.request().method()) && /\/api\/(table\/tasker\.|save_row)/.test(res.url()),
      { timeout: SETTLE_MS });
    await action();
    return answered;
  }

  /** One of the sidebar's views: 'stores', 'verify', 'issues', 'inbox', 'work', … */
  async view(name) {
    await this.open();
    await this.page.locator(`.tasker-nav-${name}`).click();
  }

  /** A project's task list, from the sidebar. */
  async openProject(name) {
    await this.open();
    await this.sidebar().getByRole('button', { name, exact: true }).click();
    await this.page.getByRole('heading', { name, exact: true }).waitFor();
  }

  // --- task lists -------------------------------------------------------------

  main() { return this.page.locator('main.tasker-main'); }

  row(title) {
    return this.main().locator('.tasker-task-row').filter({ has: this.page.getByRole('link', { name: title, exact: true }) });
  }

  /** What a task's row says beside its title: store, due mark and closure notes (not its menus). */
  rowCopy(title) { return this.row(title).locator('.tasker-task-copy'); }

  async expectRowShows(title, text) {
    await this.rowCopy(title).filter({ hasText: text }).waitFor({ timeout: SETTLE_MS });
  }

  async expectRowLacks(title, text) {
    await this.row(title).waitFor();
    await this.rowCopy(title).filter({ hasText: text }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  /** The row's due mark: { mark: 'overdue' | 'due_today' | 'scheduled' | 'due', text } or null. */
  async dueMark(title) {
    await this.row(title).waitFor();
    const chip = this.rowCopy(title).locator('.tasker-due-chip');
    if (!(await chip.count())) return null;
    return { mark: await chip.getAttribute('data-mark'), text: (await chip.textContent()).trim() };
  }

  async expectDueMark(title, mark) {
    await this.rowCopy(title).locator(`.tasker-due-chip[data-mark="${mark}"]`).waitFor({ timeout: SETTLE_MS });
  }

  doneBox(title) { return this.page.getByRole('checkbox', { name: `Mark ${title} done`, exact: true }); }

  async tickDone(title) { await this.saving(() => this.doneBox(title).click()); }

  async expectDone(title) {
    await this.page.waitForFunction(
      (box) => box?.checked, await this.doneBox(title).elementHandle(), { timeout: SETTLE_MS });
  }

  /** Whether the row's Done box can be ticked, and what it says when it can't. */
  async doneBoxState(title) {
    const box = this.doneBox(title);
    await box.waitFor();
    return { enabled: await box.isEnabled(), checked: await box.isChecked(), says: (await box.getAttribute('title')) ?? '' };
  }

  async rowState(title) {
    return this.page.getByRole('combobox', { name: `State for ${title}`, exact: true }).inputValue();
  }

  /** The titles of the tasks in the list on screen. */
  async listedTitles() {
    return this.main().locator('.tasker-task-row .tasker-task-copy > a').allTextContents();
  }

  async expectListed(title) { await this.row(title).waitFor({ timeout: SETTLE_MS }); }

  async expectNotListed(title) {
    await this.row(title).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  /** Narrows the list on screen with the Filter menu: a group ('Due', 'Store') and a choice in it. */
  async narrow(group, choice) {
    await this.main().getByRole('button', { name: /^Filter/ }).click();
    const filters = this.page.getByRole('dialog', { name: 'Filter tasks' });
    await filters.getByRole('group', { name: group, exact: true }).getByRole('checkbox', { name: choice, exact: true }).check();
    await filters.getByRole('button', { name: 'Close', exact: true }).click();
    await this.main().getByRole('button', { name: `Remove ${choice} filter`, exact: true }).waitFor();
  }

  /** Adds a task to the open project with its composer. */
  async addTaskToProject(title) {
    await this.page.getByLabel('Add task to project', { exact: true }).fill(title);
    await this.page.getByLabel('Add task to project', { exact: true }).press('Enter');
    await this.row(title).waitFor({ timeout: SETTLE_MS });
  }

  // --- task details -----------------------------------------------------------

  detail() { return this.page.getByRole('region', { name: 'Task detail content' }); }

  /** A task's details, opened by its address. */
  async openTask(id, title) {
    await this.open();
    await this.page.evaluate((hash) => { location.hash = hash; }, `task=${encodeURIComponent(id)}`);
    await this.detail().getByRole('heading', { name: title, exact: true }).waitFor();
    await this.detail().getByRole('combobox', { name: 'Task state' }).waitFor();
  }

  /** Opens a task from its row in the list on screen. */
  async openFromList(title) {
    await this.row(title).getByRole('link', { name: title, exact: true }).click();
    await this.detail().getByRole('heading', { name: title, exact: true }).waitFor();
    await this.detail().getByRole('combobox', { name: 'Task state' }).waitFor();
  }

  dueDateField() { return this.detail().getByLabel('Due date', { exact: true }); }

  async setDueDate(day) { await this.dueDateField().fill(day); }

  /** Gives the open task to this person (their row id) in its details. */
  async assignTo(personId) {
    await this.saving(() => this.detail().getByRole('combobox', { name: 'Task responsibility', exact: true }).selectOption(personId));
  }

  async dueDate() { return this.dueDateField().inputValue(); }

  /** What the details say went wrong, once they say it. */
  async refusal() {
    const alert = this.detail().getByRole('alert');
    await alert.waitFor({ timeout: SETTLE_MS });
    return (await alert.textContent()).trim();
  }

  storeChoice() { return this.detail().getByRole('combobox', { name: 'Task store' }); }

  async chooseStore(name) {
    await this.saving(() => this.storeChoice().selectOption({ label: name }));
  }

  /** The store the open task's details show as chosen. */
  async chosenStore() {
    return this.storeChoice().evaluate((select) => select.selectedOptions[0]?.textContent ?? '');
  }

  /** The stores the open task's details offer. */
  async storesOffered() {
    return this.storeChoice().locator('option').allTextContents();
  }

  subtasks() { return this.detail().getByRole('region', { name: 'Subtasks' }); }

  async addSubtask(title) {
    await this.subtasks().getByLabel('New subtask', { exact: true }).fill(title);
    await this.subtasks().getByRole('button', { name: 'Add subtask' }).click();
    await this.subtasks().getByRole('button', { name: title, exact: true }).waitFor({ timeout: SETTLE_MS });
  }

  async openSubtask(title) {
    await this.subtasks().getByRole('button', { name: title, exact: true }).click();
    await this.detail().getByRole('heading', { name: title, exact: true }).waitFor();
  }

  verifierChoice() { return this.detail().getByRole('combobox', { name: 'Task verifier' }); }

  /** The verifier the open task's details show. */
  async chosenVerifier() {
    return this.verifierChoice().evaluate((select) => select.selectedOptions[0]?.textContent ?? '');
  }

  async verifiersOffered() { return this.verifierChoice().locator('option').evaluateAll((options) => options.map((o) => o.value)); }

  verification() { return this.detail().getByRole('region', { name: 'Verification' }); }

  async acknowledge() {
    await this.verification().getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await this.verification().getByRole('button', { name: 'Acknowledge', exact: true }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  /** Submits the open task for verification with this note ('' for none). */
  async submitForVerification(note) {
    await this.verification().getByRole('button', { name: 'Submit for verification', exact: true }).click();
    await this.verification().getByRole('textbox', { name: 'What was done' }).fill(note);
    await this.verification().getByRole('button', { name: 'Submit', exact: true }).click();
  }

  async expectSubmitted() {
    await this.verification().locator('.tasker-evidence').waitFor({ timeout: SETTLE_MS });
  }

  async acceptVerification() {
    await this.verification().getByRole('button', { name: 'Accept and close', exact: true }).click();
    await this.verification().getByRole('button', { name: 'Accept and close', exact: true }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  async returnWithReason(reason) {
    await this.verification().getByRole('button', { name: 'Return', exact: true }).click();
    await this.detail().getByRole('textbox', { name: 'Reason for returning' }).fill(reason);
    await this.detail().getByRole('button', { name: 'Return task', exact: true }).click();
    await this.detail().getByRole('textbox', { name: 'Reason for returning' }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  /** The reason form the details ask for before a change ('Reason for cancelling', …), and whether its action can be taken yet. */
  async reasonAsked(label, action) {
    const field = this.detail().getByRole('textbox', { name: label, exact: true });
    await field.waitFor({ timeout: SETTLE_MS });
    return { asked: label, value: await field.inputValue(), canConfirm: await this.detail().getByRole('button', { name: action, exact: true }).isEnabled() };
  }

  async giveReason(label, action, reason) {
    await this.detail().getByRole('textbox', { name: label, exact: true }).fill(reason);
    await this.detail().getByRole('button', { name: action, exact: true }).click();
    await this.detail().getByRole('textbox', { name: label, exact: true }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  /** Chooses Cancelled for the open task's state. */
  async chooseCancelled() {
    await this.detail().getByRole('combobox', { name: 'Task state' }).selectOption('Cancelled');
  }

  async detailState() { return this.detail().getByRole('combobox', { name: 'Task state' }).inputValue(); }

  // --- Stores -----------------------------------------------------------------

  storeTable() { return this.page.getByRole('table', { name: 'Work by store' }); }

  async openStores() {
    await this.view('stores');
    await this.storeTable().waitFor();
  }

  storeRow(name) {
    return this.storeTable().getByRole('row').filter({ has: this.page.getByRole('rowheader', { name, exact: true }) });
  }

  /** A store's row: { total, ongoing, completed, overdue, scheduled }. */
  async storeCounts(name) {
    const row = this.storeRow(name);
    await row.waitFor({ timeout: SETTLE_MS });
    const counts = {};
    for (const bucket of ['total', 'ongoing', 'completed', 'overdue', 'scheduled'])
      counts[bucket] = Number((await row.locator(`td[data-bucket="${bucket}"]`).textContent()).trim());
    return counts;
  }

  async addStore(name, type) {
    await this.page.getByLabel('New store', { exact: true }).fill(name);
    await this.page.getByRole('combobox', { name: 'Store type' }).selectOption(type);
    await this.page.getByRole('button', { name: 'Add store', exact: true }).click();
    await this.storeRow(name).waitFor({ timeout: SETTLE_MS });
  }

  /** Opens the tasks behind one of a store's counts ('Overdue', 'Completed', …). */
  async openCount(store, column) {
    await this.storeRow(store).getByRole('button', { name: new RegExp(`^${store}: \\d+ ${column.toLowerCase()} tasks?$`) }).click();
    this.drill = this.page.getByRole('region', { name: `${store} · ${column}`, exact: true });
    await this.drill.waitFor();
  }

  /** The titles and store marks of the tasks behind the opened count. */
  async drilledTasks() {
    const rows = this.drill.locator('.tasker-task-row');
    const tasks = [];
    for (let i = 0; i < await rows.count(); i += 1) {
      const copy = rows.nth(i).locator('.tasker-task-copy');
      tasks.push({
        title: (await copy.locator('> a').textContent()).trim(),
        store: (await copy.locator('.tasker-store-chip').textContent().catch(() => '')).trim(),
      });
    }
    return tasks;
  }

  // --- To verify --------------------------------------------------------------

  async openToVerify() {
    await this.view('verify');
    await this.page.getByRole('region', { name: 'To verify' }).waitFor();
  }

  async expectToVerify(title) {
    await this.page.getByRole('region', { name: 'To verify' }).getByRole('link', { name: title, exact: true }).waitFor({ timeout: SETTLE_MS });
  }

  async openFromToVerify(title) {
    await this.page.getByRole('region', { name: 'To verify' }).getByRole('link', { name: title, exact: true }).click();
    await this.detail().getByRole('heading', { name: title, exact: true }).waitFor();
  }

  // --- Issues -----------------------------------------------------------------

  async openIssues() {
    await this.view('issues');
    await this.page.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
  }

  /** Raises an issue with the Raise an issue form; `values` use the form's own labels' meanings. */
  async raiseIssue({ title, category, severity, store, asset }) {
    await this.page.getByRole('button', { name: 'Raise an issue', exact: true }).click();
    const form = this.page.getByRole('form', { name: 'Raise an issue' });
    await form.getByRole('textbox', { name: 'What happened' }).fill(title);
    await form.getByRole('combobox', { name: 'Category', exact: true }).selectOption(category);
    await form.getByRole('combobox', { name: 'Severity', exact: true }).selectOption(severity);
    await form.getByRole('combobox', { name: 'Store', exact: true }).selectOption({ label: store });
    await form.getByRole('textbox', { name: 'Asset or area' }).fill(asset);
    await form.getByRole('button', { name: 'Raise issue', exact: true }).click();
    await form.waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  issueList(closed = false) { return this.page.getByRole('list', { name: closed ? 'All issues' : 'Open issues' }); }

  issueRow(title, closed = false) { return this.issueList(closed).getByRole('listitem', { name: title, exact: true }); }

  async showClosedIssues() {
    await this.page.getByRole('checkbox', { name: 'Show closed' }).check();
  }

  /** The one-line clock an issue's row shows ('Fix in 23h', 'Breached by 30m', 'Closed · fix time was breached'). */
  async issueClockChip(title, closed = false) {
    const row = this.issueRow(title, closed);
    await row.waitFor({ timeout: SETTLE_MS });
    return (await row.locator('.tasker-issue-clock-chip').textContent()).trim();
  }

  issueDetail() { return this.page.getByRole('region', { name: 'Issue detail' }); }

  async openIssue(title, closed = false) {
    await this.issueRow(title, closed).getByRole('link', { name: title, exact: true }).click();
    await this.issueDetail().getByRole('heading', { name: title, exact: true }).waitFor();
  }

  /** What an issue's clocks say: { response, resolution, verification } as text. */
  async issueClocks() {
    const text = async (name) => (await this.issueDetail().getByRole('group', { name }).textContent()).trim();
    return { response: await text('Response clock'), resolution: await text('Resolution clock'), verification: await text('Verification clock') };
  }

  /** The time on the resolution clock, as the details say it ('2h', '45m'). */
  async onTheClock() {
    const line = this.issueDetail().getByRole('group', { name: 'Resolution clock' }).locator('p').filter({ hasText: 'on the clock' });
    const match = (await line.textContent()).trim().match(/on the clock (.+)$/);
    return match ? match[1] : null;
  }

  /** Reopens the issue page until the issue's details say `expected` is on the clock, or time runs out; returns what they last said. */
  async waitOnTheClock(title, expected, timeout = SETTLE_MS) {
    const deadline = Date.now() + timeout;
    let said = null;
    while (Date.now() < deadline) {
      await this.openIssues();
      await this.openIssue(title);
      said = await this.onTheClock();
      if (said === expected) return said;
      await this.page.waitForTimeout(500);
    }
    return said;
  }

  async issueStatusLines() {
    return this.issueDetail().locator('.tasker-issue-status').allTextContents();
  }

  /** The escalation log's entries of a kind ('breach', 'reminder', …), as text. */
  async issueLog(kind) {
    return this.issueDetail().getByRole('list', { name: 'Escalation log' }).locator(`li[data-kind="${kind}"]`).allTextContents();
  }

  /** The "For you" notices of a kind about an issue, as text. */
  async noticesFor(title, kind) {
    const notices = this.page.getByRole('region', { name: 'For you' });
    if (!(await notices.count())) return [];
    return notices.locator(`li[data-kind="${kind}"]`).filter({ has: this.page.getByRole('link', { name: title, exact: true }) }).allTextContents();
  }

  async submitIssue(note) {
    await this.issueDetail().getByRole('button', { name: /^(Submit for verification|Close issue)$/ }).click();
    await this.issueDetail().getByRole('textbox', { name: 'What was done' }).fill(note);
    await this.issueDetail().getByRole('button', { name: 'Submit', exact: true }).click();
    await this.issueDetail().getByRole('textbox', { name: 'What was done' }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  async acceptIssue() {
    await this.issueDetail().getByRole('button', { name: 'Accept and close', exact: true }).click();
    await this.issueDetail().getByRole('button', { name: 'Accept and close', exact: true }).waitFor({ state: 'detached', timeout: SETTLE_MS });
  }

  async issueDetailText() { return (await this.issueDetail().textContent()).trim(); }
}

module.exports = { TaskerPage };
