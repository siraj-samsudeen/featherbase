'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Api } = require('../api');
const { BASE_URL, REPO_ROOT, restartAcceptance } = require('../stack');

// #941: Tickets inside the platform shell, and app accents. Selectors and
// addresses for the shared navigation (`<featherbase-sidebar>`, the app's
// light-DOM rows), the shared bar (`<featherbase-bar>`, a shadow root) and
// Tickets' own page live here; steps only call these methods.
const TICKETS = '/tickets/';
const TASKER = '/tasker/';
const SIDEBAR = 'featherbase-sidebar';
const BAR = 'featherbase-bar';
const BAR_THEME_ROOT = '[data-testid=bar-theme-root]';
const ACCENT_ATTRIBUTE = 'data-featherbase-accent';
const PLUM_FIXTURE = resolve(__dirname, '../fixtures/plum-accent');
const TICKETS_PACKAGE = resolve(REPO_ROOT, 'example-apps/tickets');
const SHORT = 10_000;

const manifest = relative => JSON.parse(readFileSync(resolve(REPO_ROOT, relative, 'featherbase.json'), 'utf8'));

/** The accent names Featherbase provides, as the platform declares them. */
function providedAccents() {
  const source = readFileSync(resolve(REPO_ROOT, 'packages/shared/src/app-accents.ts'), 'utf8');
  const list = /APP_ACCENTS\s*=\s*\[([^\]]*)\]/.exec(source);
  assert.ok(list, 'Featherbase declares no accents (APP_ACCENTS in packages/shared)');
  return [...list[1].matchAll(/'([a-z]+)'/g)].map(([, name]) => name);
}

async function until(read, done, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    value = await read();
  }
  return value;
}

class TicketsWorkspace {
  constructor(tickets) { this.t = tickets; }

  get world() { return this.t.world; }

  // ---- the browser ----

  async open(path = TICKETS, who = this.t.actor) {
    this.page = who ? await this.world.signedIn(who) : await this.world.asSystemManager();
    await this.page.goto(`${BASE_URL}${path}`);
    await this.page.locator(`${BAR} ${BAR_THEME_ROOT}`).waitFor();
    if (path === TICKETS) await this.page.getByRole('button', { name: /New ticket/ }).first().waitFor();
    return this.page;
  }

  sidebar() { return this.page.locator(SIDEBAR); }

  async sidebarPresent() {
    await this.sidebar().waitFor({ state: 'attached', timeout: SHORT }).catch(() => {
      throw new Error(`the page draws no shared app navigation (<${SIDEBAR}>)`);
    });
  }

  // ---- accents ----

  static ticketsNamesGreen() { assert.equal(manifest('example-apps/tickets').accent, 'green', 'Tickets names no green accent'); }
  static taskerNamesNone() { assert.equal(manifest('example-apps/tasker').accent, undefined, 'Tasker names an accent'); }

  async installTasker() {
    const api = await Api.asSystemManager();
    const { installed } = await (await api.call('GET', '/api/apps', undefined, [200], 'installed apps')).json();
    if (!installed.some(app => app.name === 'tasker'))
      await api.call('POST', '/api/apps/prepare-install', { name: 'tasker' }, [201], 'prepare and install Tasker');
    await api.admitTaskerAdministrator();
  }

  /** The action colour Featherbase paints for an accent (or none: its own),
   *  in the bar's current theme, resolved by the platform's own stylesheet. */
  async actionColour(accent) {
    return this.page.evaluate(([bar, root, attribute, accent]) => {
      const shadow = document.querySelector(bar).shadowRoot;
      const probe = document.createElement('span');
      probe.setAttribute('data-theme', shadow.querySelector(root).dataset.theme ?? 'light');
      if (accent) probe.setAttribute(attribute, accent);
      probe.style.color = 'var(--color-action)';
      shadow.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, [BAR, BAR_THEME_ROOT, ACCENT_ATTRIBUTE, accent]);
  }

  mainButtonColour() {
    return this.page.getByRole('button', { name: /New ticket/ }).first().evaluate(b => getComputedStyle(b).backgroundColor);
  }

  async selectedRowColour() {
    await this.sidebarPresent();
    const row = this.sidebar().locator(':scope > [aria-current=page]').first();
    await row.waitFor({ timeout: SHORT }).catch(() => { throw new Error('the shared navigation marks no view as selected'); });
    return row.evaluate(r => getComputedStyle(r).color);
  }

  async expectAccent(theme) {
    await until(() => this.page.locator(`${BAR} ${BAR_THEME_ROOT}`).getAttribute('data-theme'), value => value === theme);
    const green = await this.actionColour('green');
    const blue = await this.actionColour(null);
    const button = await until(() => this.mainButtonColour(), value => value === green);
    assert.equal(button, green, `Tickets' main button is ${button}${button === blue ? " (Featherbase's own blue)" : ''}, not the ${theme} green ${green}`);
    const row = await until(() => this.selectedRowColour(), value => value === green);
    assert.equal(row, green, `the selected view is ${row}${row === blue ? " (Featherbase's own blue)" : ''}, not the ${theme} green ${green}`);
    assert.notEqual(green, blue, `Featherbase provides no ${theme} green distinct from its blue`);
  }

  async expectOwnBlue() {
    const blue = await this.actionColour(null);
    const row = await this.selectedRowColour();
    assert.equal(row, blue, `Tasker's selected view is ${row}, not Featherbase's own ${blue}`);
  }

  // ---- install refusal ----

  async unknownAccentApp() {
    const accent = manifest(PLUM_FIXTURE).accent;
    assert.ok(!providedAccents().includes(accent), `the fixture's accent ${accent} is one Featherbase provides`);
    // Tickets stays on the path, as its own scenarios expect it to be.
    await restartAcceptance({ FEATHERBASE_APP_PATHS: JSON.stringify([TICKETS_PACKAGE, PLUM_FIXTURE]) });
    this.fixture = manifest(PLUM_FIXTURE).name;
  }

  async install() {
    const api = await Api.asSystemManager();
    const response = await api.call('POST', '/api/install_app', { name: this.fixture });
    this.installStatus = response.status();
    this.installBody = await response.text();
  }

  async expectRefusedNamingAccents() {
    assert.ok(this.installStatus >= 400, `the installation was not refused (${this.installStatus})`);
    for (const accent of providedAccents())
      assert.ok(this.installBody.includes(accent), `the refusal does not name the accent ${accent}: ${this.installBody}`);
    const api = await Api.asSystemManager();
    const { installed } = await (await api.call('GET', '/api/apps', undefined, [200], 'installed apps')).json();
    assert.ok(!installed.some(app => app.name === this.fixture), 'the app was installed anyway');
  }
}

module.exports = { TicketsWorkspace, TASKER };
