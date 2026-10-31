'use strict';

// The World: a thin holder for the signed-in browser pages and API setup.
// Steps drive page objects (support/pages/); they never see a selector
// or a URL.

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setWorldConstructor, setDefaultTimeout, Before, BeforeAll, After, AfterAll } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const { BASE_URL } = require('./stack');
const { Api, SYSTEM_MANAGER, signedInState } = require('./api');
const { LoginPage } = require('./pages/login-page');
const { AccountMenu } = require('./pages/account-menu');

// For a person watching or debugging; agents and CI set none of these, and
// browser checks run headless (CLAUDE.md).
// HEADED=1: a visible browser, slowed down so each action can be followed.
// PWDEBUG=1: Playwright's Inspector, pausing before each action (headed).
// VIDEO=1: a slowed-down video of every scenario in reports/videos/, headless.
const HEADED = process.env.HEADED === '1';
const PWDEBUG = Boolean(process.env.PWDEBUG) && process.env.PWDEBUG !== '0';
const VIDEO = process.env.VIDEO === '1';
setDefaultTimeout(PWDEBUG ? -1 : HEADED || VIDEO ? 300_000 : 60_000);

// In CI (or with TRACE=1) every context is traced; a failed scenario's traces
// are kept here, the rest discarded. Open one with `npx playwright show-trace
// <zip>`. Locally a failure is simply rerun, so tracing's cost isn't paid.
const TRACE = Boolean(process.env.CI) || process.env.TRACE === '1';
const REPORTS = path.resolve(__dirname, '../reports');
const TRACES = path.join(REPORTS, 'traces');
const VIDEOS = path.join(REPORTS, 'videos');
const VIDEO_SCRATCH = path.join(VIDEOS, '.recording');

// Test-only password for the people a scenario creates on the throwaway
// acceptance database.
const PERSON_PASSWORD = 'acceptance-person-pw';

let browser = null;
let systemManagerState = null; // signed-in storage state, captured once per run

function launchOptions() {
  if (PWDEBUG) return { headless: false }; // the Inspector does the pausing
  if (HEADED) return { headless: false, slowMo: 400 };
  if (VIDEO) return { headless: true, slowMo: 400 };
  return { headless: true };
}

async function launch() {
  browser ??= await chromium.launch(launchOptions());
  return browser;
}

/** "Section Mapping's cards show …" -> "section-mapping-s-cards-show-…" */
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

let scenarioCount = 0; // run order, for the videos' names

// A desktop screen, and a phone: 375px wide, as the e2e suite's phone tests use.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 812 };


class FeatherbaseWorld {
  constructor({ attach }) {
    this.attach = attach;
    this.page = null;
    this.context = null;
    this.sheet = null; // { tableName, fileName, columns, rows } given by a step
    this.table = null; // the table the scenario is about
    this.people = new Map(); // 'the user' / 'a colleague' -> { email, roles, context, page }
    this.viewport = DESKTOP;
    this.scenario = null; // { order, slug }, set before each scenario
    this.contexts = []; // { who, context, page } for every browser context opened, in order
  }

  /** A traced browser context for one of the scenario's people (and its video, with VIDEO=1). */
  async newPage(who, storageState) {
    const context = await (await launch()).newContext({
      baseURL: BASE_URL,
      storageState,
      viewport: this.viewport,
      ...(VIDEO ? { recordVideo: { dir: VIDEO_SCRATCH, size: this.viewport } } : {}),
    });
    if (TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    this.contexts.push({ who, context, page });
    return { context, page };
  }

  /** Every page of this scenario, open now or later, is on a phone-sized screen. */
  async usePhone() {
    this.viewport = PHONE;
    for (const page of this.openPages()) await page.setViewportSize(PHONE);
  }

  openPages() {
    return [this.page, ...[...this.people.values()].map((p) => p.page)].filter(Boolean);
  }

  /** A browser page signed in as a System Manager. */
  async asSystemManager() {
    if (this.page) return this.page;
    systemManagerState ??= await signedInState(SYSTEM_MANAGER.user, SYSTEM_MANAGER.password);
    ({ context: this.context, page: this.page } = await this.newPage('system-manager', systemManagerState));
    return this.page;
  }

  /**
   * A person of this scenario ('the user', 'a colleague'): not a System
   * Manager, created fresh with the given roles the first time they are named,
   * so no arrangement saved by an earlier scenario follows them.
   */
  async person(who, roles) {
    if (this.people.has(who)) return this.people.get(who);
    const email = `acceptance-${randomUUID().slice(0, 8)}@example.com`;
    await this.withApi((api) => api.createPerson(email, PERSON_PASSWORD, roles));
    const person = { email, roles, context: null, page: null };
    this.people.set(who, person);
    return person;
  }

  /**
   * That person's browser page, already signed in: their session comes from
   * the API, so no sign-in form is typed for setup.
   */
  async signedIn(who) {
    const person = this.people.get(who);
    if (!person) throw new Error(`no one called "${who}" in this scenario`);
    if (person.page) return person.page;
    const state = await signedInState(person.email, PERSON_PASSWORD);
    ({ context: person.context, page: person.page } = await this.newPage(slug(who), state));
    return person.page;
  }

  /**
   * The page of whoever "the user" is in this scenario: the person created as
   * 'the user' when there is one, otherwise the System Manager (a scenario
   * where the user creates tables).
   */
  async actor() {
    return this.people.has('the user') ? this.signedIn('the user') : this.asSystemManager();
  }

  /** Signs the person out from the account menu, then back in through the form. */
  async signOutAndBackIn(who) {
    const page = await this.signedIn(who);
    await new AccountMenu(page).signOut();
    await new LoginPage(page).signIn(this.people.get(who).email, PERSON_PASSWORD);
    return page;
  }

  /** Runs setup through the run's API session as a System Manager. */
  async withApi(fn) {
    return fn(await Api.asSystemManager());
  }

  /** Deletes a table left by an earlier scenario, so a create starts fresh. */
  async removeTableIfPresent(name) {
    await this.withApi((api) => api.removeTableIfPresent(name));
  }
}

setWorldConstructor(FeatherbaseWorld);

BeforeAll(function () {
  // Only this run's traces are in reports/. Videos are replaced only by a run
  // that records new ones, so a later run doesn't delete the ones to review.
  fs.rmSync(TRACES, { recursive: true, force: true });
  if (VIDEO) fs.rmSync(VIDEOS, { recursive: true, force: true });
});

Before(function ({ pickle }) {
  scenarioCount += 1;
  this.scenario = { order: String(scenarioCount).padStart(2, '0'), slug: slug(pickle.name) };
});

After(async function ({ result }) {
  const failed = result?.status === 'FAILED';
  if (failed) {
    for (const page of this.openPages()) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) this.attach(shot, 'image/png');
    }
  }
  // "<slug>" when the scenario opened one browser, "<slug>-<who>" for each when more.
  const name = (who) => (this.contexts.length > 1 ? `${this.scenario.slug}-${who}` : this.scenario.slug);
  for (const { who, context, page } of this.contexts) {
    if (TRACE && failed) {
      fs.mkdirSync(TRACES, { recursive: true });
      await context.tracing.stop({ path: path.join(TRACES, `${name(who)}.zip`) });
    } else if (TRACE) {
      await context.tracing.stop();
    }
    const video = VIDEO ? page.video() : null;
    await context.close();
    if (video) {
      await video.saveAs(path.join(VIDEOS, `${this.scenario.order}-${name(who)}.webm`));
      await video.delete();
    }
  }
});

AfterAll(async function () {
  await Api.disposeAll();
  await browser?.close();
  fs.rmSync(VIDEO_SCRATCH, { recursive: true, force: true });
});
