'use strict';

// Setup for Tasker scenarios, through the API: Tasker installed, its data from
// earlier scenarios cleared, the scenario's named members (Meena, Ravi, …), and
// the stores, projects, tasks and issues a scenario starts from. What a member
// then does and sees goes through the browser (support/pages/tasker.js).

const { randomUUID } = require('node:crypto');
const { request } = require('playwright');
const { API_URL, acceptanceSql } = require('./stack');
const { Api, SYSTEM_MANAGER } = require('./api');
const { PERSON_PASSWORD } = require('./world');
const { appNow } = require('./app-clock');
const { TaskerPage } = require('./pages/tasker');

// The full names of the people a scenario calls by role; named members
// (Meena, Ravi, …) are called by their own names.
const FULL_NAMES = { 'the user': 'Anitha', 'a member': 'Bala', 'another member': 'Chitra' };

const TASKER = 'tasker';

/** 'YYYY-MM-DD' for a day this many days from the given one. */
function dayFrom(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * The API as one person, signed in afresh whenever the scenario has moved the
 * app's clock since: a session is valid only on the clock it was opened on
 * (its token's issue time and expiry are the server's time).
 */
class ClockedApi extends Api {
  constructor(world, ctx, user, password, version) {
    super(ctx, {});
    Object.assign(this, { world, user, password, version, clock: undefined });
  }

  async call(...args) {
    const clock = this.world.appClock?.getTime() ?? null;
    if (clock !== this.clock) {
      const login = await this.ctx.post('/api/login', { data: { usr: this.user, pwd: this.password } });
      if (!login.ok()) throw new Error(`sign-in as ${this.user} failed: ${login.status()} ${await login.text()}`);
      const { token } = await login.json();
      this.headers = { Authorization: `Bearer ${token}`, 'X-Featherbase-App-Version': this.version };
      this.clock = clock;
    }
    return super.call(...args);
  }
}

class TaskerSetup {
  /** The scenario's Tasker setup: on first use, Tasker is installed and earlier scenarios' Tasker data is gone. */
  static async of(world) {
    if (!world.tasker) {
      world.tasker = new TaskerSetup(world);
      await world.tasker.ready();
    }
    return world.tasker;
  }

  constructor(world) {
    this.world = world;
    this.version = null; // 'tasker@<version>', the header app Tables are read and written under
    this.members = new Map(); // name -> { id, name, email, api }
    this.stores = new Map(); // name -> row
    this.projects = new Map(); // name -> row
    this.tasks = new Map(); // title -> row
    this.issues = new Map(); // title -> row
    this.current = null; // the task the scenario is talking about ("it", "the task")
    this.issue = null; // the issue the scenario is talking about
    this.apis = [];
  }

  async ready() {
    const admin = await Api.asSystemManager();
    const { installed } = await (await admin.call('GET', '/api/apps', undefined, [200], 'installed apps')).json();
    if (!installed.some((app) => app.name === TASKER))
      await admin.call('POST', '/api/apps/prepare-install', { name: TASKER }, [201], 'prepare and install Tasker');
    await admin.admitTaskerAdministrator();
    const apps = await (await admin.call('GET', '/api/apps', undefined, [200], 'installed apps')).json();
    this.version = `${TASKER}@${apps.installed.find((app) => app.name === TASKER).version}`;
    this.admin = await this.signedIn(SYSTEM_MANAGER.user, SYSTEM_MANAGER.password);
    // Every scenario names its own stores, projects, tasks and issues ("Keelkattalai
    // Store"), and counts them; the throwaway database keeps earlier scenarios'
    // rows, so Tasker's own Tables start empty here.
    const relations = await acceptanceSql(
      "select physical_schema, physical_relation from featherbase.table_def where owner_app = 'tasker'");
    if (relations.length)
      await acceptanceSql(`truncate ${relations.map((r) => `"${r.physical_schema}"."${r.physical_relation}"`).join(', ')} cascade`);
  }

  /** A Tasker member with this name, created the first time the scenario names them. */
  async member(name) {
    if (this.members.has(name)) return this.members.get(name);
    const email = `acceptance-${randomUUID().slice(0, 8)}@example.com`;
    const made = await this.admin.call('POST', '/api/save_row',
      { table: 'Person', row: { email, full_name: FULL_NAMES[name] ?? name, enabled: true, roles: [{ role: 'Tasker Member' }] } },
      [201], `create ${name}`);
    const { row_id: id } = await made.json();
    await this.admin.call('POST', '/api/set_password', { user: id, password: PERSON_PASSWORD }, [200], `set ${name}'s password`);
    // The World signs them in by this name: world.signedIn(name).
    this.world.people.set(name, { email, roles: ['Tasker Member'], context: null, page: null });
    const member = { id, name, email, api: null };
    this.members.set(name, member);
    return member;
  }

  /** The API as this member, for setup they do themselves (a private task, an owner's step). */
  async as(name) {
    const member = await this.member(name);
    member.api ??= await this.signedIn(member.email, PERSON_PASSWORD);
    return member.api;
  }

  async signedIn(user, password) {
    const ctx = await request.newContext({ baseURL: API_URL });
    this.apis.push(ctx);
    return new ClockedApi(this.world, ctx, user, password, this.version);
  }

  async dispose() {
    for (const ctx of this.apis) await ctx.dispose();
  }

  // --- the app's day ----------------------------------------------------------

  /** Today on the app's clock, 'YYYY-MM-DD' (the browser's day, which marks tasks). */
  today() {
    const now = appNow(this.world);
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  daysFromToday(offset) {
    return dayFrom(this.today(), offset);
  }

  // --- rows -------------------------------------------------------------------

  async read(table, id, api = this.admin) {
    return api.row(table, id);
  }

  /** Saves a row (new, or changes to one read fresh) and returns it as stored. */
  async save(table, row, api = this.admin) {
    if (row.row_id) {
      const current = await api.row(table, row.row_id);
      return api.saveRow(table, { ...row, updated_at: current.updated_at });
    }
    return api.saveRow(table, row);
  }

  /** The same change, answered: { ok, status, message } instead of throwing on a refusal. */
  async attempt(table, row, api) {
    const current = await api.row(table, row.row_id);
    const res = await api.call('POST', '/api/save_row', { table, row: { ...row, updated_at: current.updated_at } });
    const text = await res.text();
    let message = text;
    try { const body = JSON.parse(text); message = body.error?.message ?? body.message ?? text; } catch { /* plain text */ }
    return { ok: res.ok(), status: res.status(), message: String(message) };
  }

  async store(name, values = {}) {
    if (!this.stores.has(name))
      this.stores.set(name, await this.save('tasker.store', { store_name: name, store_type: 'Store', ...values }));
    else if (Object.keys(values).length)
      this.stores.set(name, await this.save('tasker.store', { row_id: this.stores.get(name).row_id, ...values }));
    return this.stores.get(name);
  }

  /** Every store with this name, as stored. */
  async storesNamed(name) {
    const filters = encodeURIComponent(JSON.stringify([['store_name', '=', name]]));
    const res = await this.admin.call('GET', `/api/table/tasker.store?filters=${filters}`, undefined, [200], 'list stores');
    return (await res.json()).data;
  }

  /** A shared project; tasks the scenario does not place elsewhere go in "Store operations". */
  async project(name = 'Store operations', values = {}) {
    if (!this.projects.has(name))
      this.projects.set(name, await this.save('tasker.project', { project_name: name, ...values }));
    else if (Object.keys(values).length)
      this.projects.set(name, await this.save('tasker.project', { row_id: this.projects.get(name).row_id, ...values }));
    return this.projects.get(name);
  }

  /** A task in a shared project, created by the System Manager unless `api` says who. */
  async task(title, values = {}, api = this.admin) {
    const project = values.project === undefined ? (await this.project()).row_id : values.project;
    const row = await this.save('tasker.task', { task_title: title, ...values, project }, api);
    this.tasks.set(title, row);
    this.current = row;
    return row;
  }

  /** Changes to a task the scenario already has. */
  async change(title, values, api = this.admin) {
    const row = await this.save('tasker.task', { row_id: this.tasks.get(title).row_id, ...values }, api);
    this.tasks.set(title, row);
    this.current = row;
    return row;
  }

  /** A task the scenario did not make itself (one a member added in the browser), by its title. */
  async findTask(title) {
    const filters = encodeURIComponent(JSON.stringify([['task_title', '=', title]]));
    const res = await this.admin.call('GET', `/api/table/tasker.task?filters=${filters}&fields=${encodeURIComponent('["row_id"]')}`, undefined, [200], 'find task');
    const [found] = (await res.json()).data;
    if (!found) throw new Error(`no task "${title}" was saved`);
    const row = await this.read('tasker.task', found.row_id);
    this.tasks.set(title, row);
    this.current = row;
    return row;
  }

  async findIssue(title) {
    const filters = encodeURIComponent(JSON.stringify([['issue_title', '=', title]]));
    const res = await this.admin.call('GET', `/api/table/tasker.issue?filters=${filters}&fields=${encodeURIComponent('["row_id"]')}`, undefined, [200], 'find issue');
    const [found] = (await res.json()).data;
    if (!found) throw new Error(`no issue "${title}" was saved`);
    const row = await this.read('tasker.issue', found.row_id);
    this.issues.set(title, row);
    this.issue = row;
    return row;
  }

  /** The name of the project a task is in. */
  projectOf(task = this.current) {
    const project = [...this.projects.values()].find((p) => p.row_id === task.project);
    if (!project) throw new Error(`task "${task.task_title}" is in no project of this scenario`);
    return project.project_name;
  }

  taskNamed(title) {
    const task = this.tasks.get(title);
    if (!task) throw new Error(`the scenario has no task "${title}"`);
    return task;
  }

  /** The task's row as stored now. */
  async fresh(task = this.current) {
    return this.read('tasker.task', task.row_id);
  }

  async issueRow(issue = this.issue, api = this.admin) {
    return this.read('tasker.issue', issue.row_id, api);
  }

  /** An issue raised through the API (by the System Manager unless `api` says who). */
  async raise(title, values = {}, api = this.admin) {
    const row = await this.save('tasker.issue', {
      issue_title: title, category: 'Equipment failure', severity: 'High', owner_function: 'Facilities', ...values,
    }, api);
    this.issues.set(title, row);
    this.issue = row;
    return row;
  }

  /** An SLA rule row for a severity, replacing the built-in default. */
  async slaRule(severity, values) {
    return this.save('tasker.sla_rule', { severity, ...values });
  }

  async functionHead(ownerFunction, head) {
    return this.save('tasker.function_head', { owner_function: ownerFunction, head });
  }

  /**
   * One run of Tasker's escalation job, which re-checks every open issue's
   * clock (it is scheduled every minute; this asks the platform for a run now,
   * on the app's clock) and waits until it has finished.
   */
  async escalationRun(timeout = 45_000) {
    const res = await this.admin.call('POST', '/api/enqueue_job', { method: 'tasker.escalate_issues' }, [201], 'run the escalation job');
    const { name } = await res.json();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const [job] = await acceptanceSql('select job_status, error from featherbase.background_job where row_id = $1', [name]);
      if (job?.job_status === 'done') return;
      if (job?.job_status === 'failed') throw new Error(`the escalation job failed: ${job.error}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('the escalation job did not finish');
  }
}

/**
 * Tasker in the browser as this member of the scenario, signed in. They
 * become the one looking at it, for steps that say what "the task shows".
 */
async function taskerAs(world, who) {
  const setup = await TaskerSetup.of(world);
  await setup.member(who);
  const tasker = new TaskerPage(await world.signedIn(who));
  world.taskerViewer = who;
  return tasker;
}

/** Tasker as whoever last looked at it in this scenario, or the user. */
function taskerViewer(world) {
  return taskerAs(world, world.taskerViewer ?? 'the user');
}

module.exports = { TaskerSetup, taskerAs, taskerViewer, dayFrom };
