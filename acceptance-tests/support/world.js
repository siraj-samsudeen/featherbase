'use strict';

// The World: a thin holder for the signed-in browser page and API setup.
// Steps drive page objects (support/pages/); they never see a selector
// or a URL.

const { setWorldConstructor, setDefaultTimeout, After, AfterAll } = require('@cucumber/cucumber');
const { chromium, request } = require('playwright');
const { BASE_URL, API_URL } = require('./stack');
const { LoginPage } = require('./pages/login-page');

setDefaultTimeout(60_000);

// The seeded System Manager of a fresh database (apps/web/e2e/fixtures.ts).
const SYSTEM_MANAGER = { user: 'Administrator', password: process.env.ADMIN_PASSWORD ?? 'admin' };

let browser = null;
let systemManagerState = null; // signed-in storage state, captured once per run

class FeatherbaseWorld {
  constructor({ attach }) {
    this.attach = attach;
    this.page = null;
    this.context = null;
    this.sheet = null; // { tableName, fileName, columns, rows } given by a step
    this.table = null; // the table the scenario is about
  }

  /** A browser page signed in as a System Manager (headless, always). */
  async asSystemManager() {
    if (this.page) return this.page;
    browser ??= await chromium.launch({ headless: true });
    if (!systemManagerState) {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      await new LoginPage(page).signIn(SYSTEM_MANAGER.user, SYSTEM_MANAGER.password);
      systemManagerState = await context.storageState();
      await context.close();
    }
    this.context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: systemManagerState,
      viewport: { width: 1280, height: 900 },
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  /** Deletes a table left by an earlier scenario, so a create starts fresh. */
  async removeTableIfPresent(name) {
    const api = await request.newContext({ baseURL: API_URL });
    try {
      const login = await api.post('/api/login', {
        data: { usr: SYSTEM_MANAGER.user, pwd: SYSTEM_MANAGER.password },
      });
      if (!login.ok()) throw new Error(`API sign-in failed: ${login.status()} ${await login.text()}`);
      const { token } = await login.json();
      const headers = { Authorization: `Bearer ${token}` };
      const enc = encodeURIComponent(name);
      const meta = await api.get(`/api/table/${enc}:meta`, { headers });
      if (meta.status() !== 200) return;
      const del = await api.delete(`/api/table_def/${enc}`, { headers });
      if (!del.ok()) throw new Error(`could not remove leftover table ${name}: ${del.status()} ${await del.text()}`);
    } finally {
      await api.dispose();
    }
  }
}

setWorldConstructor(FeatherbaseWorld);

After(async function ({ result }) {
  if (this.page && result?.status === 'FAILED') {
    const shot = await this.page.screenshot({ fullPage: true }).catch(() => null);
    if (shot) this.attach(shot, 'image/png');
  }
  await this.context?.close();
});

AfterAll(async function () {
  await browser?.close();
});
