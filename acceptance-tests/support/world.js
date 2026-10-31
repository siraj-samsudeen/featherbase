'use strict';

// The World: a thin holder for the signed-in browser pages and API setup.
// Steps drive page objects (support/pages/); they never see a selector
// or a URL.

const { randomUUID } = require('node:crypto');
const { setWorldConstructor, setDefaultTimeout, After, AfterAll } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const { BASE_URL } = require('./stack');
const { Api, SYSTEM_MANAGER } = require('./api');
const { LoginPage } = require('./pages/login-page');
const { AccountMenu } = require('./pages/account-menu');

setDefaultTimeout(60_000);

// Test-only password for the people a scenario creates on the throwaway
// acceptance database.
const PERSON_PASSWORD = 'acceptance-person-pw';

let browser = null;
let systemManagerState = null; // signed-in storage state, captured once per run

async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

async function newPage(storageState) {
  const context = await (await launch()).newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: { width: 1280, height: 900 },
  });
  return { context, page: await context.newPage() };
}

class FeatherbaseWorld {
  constructor({ attach }) {
    this.attach = attach;
    this.page = null;
    this.context = null;
    this.sheet = null; // { tableName, fileName, columns, rows } given by a step
    this.table = null; // the table the scenario is about
    this.people = new Map(); // 'the user' / 'a colleague' -> { email, roles, context, page }
  }

  /** A browser page signed in as a System Manager (headless, always). */
  async asSystemManager() {
    if (this.page) return this.page;
    if (!systemManagerState) {
      const { context, page } = await newPage();
      await new LoginPage(page).signIn(SYSTEM_MANAGER.user, SYSTEM_MANAGER.password);
      systemManagerState = await context.storageState();
      await context.close();
    }
    ({ context: this.context, page: this.page } = await newPage(systemManagerState));
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

  /** That person's browser page, signing them in through the form if needed. */
  async signedIn(who) {
    const person = this.people.get(who);
    if (!person) throw new Error(`no one called "${who}" in this scenario`);
    if (person.page) return person.page;
    ({ context: person.context, page: person.page } = await newPage());
    await new LoginPage(person.page).signIn(person.email, PERSON_PASSWORD);
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

  /** Runs setup through the API as a System Manager. */
  async withApi(fn) {
    const api = await Api.asSystemManager();
    try {
      return await fn(api);
    } finally {
      await api.dispose();
    }
  }

  /** Deletes a table left by an earlier scenario, so a create starts fresh. */
  async removeTableIfPresent(name) {
    await this.withApi((api) => api.removeTableIfPresent(name));
  }
}

setWorldConstructor(FeatherbaseWorld);

After(async function ({ result }) {
  const pages = [this.page, ...[...this.people.values()].map((p) => p.page)].filter(Boolean);
  if (result?.status === 'FAILED') {
    for (const page of pages) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) this.attach(shot, 'image/png');
    }
  }
  await this.context?.close();
  for (const person of this.people.values()) await person.context?.close();
});

AfterAll(async function () {
  await browser?.close();
});
