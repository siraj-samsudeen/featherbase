'use strict';

// The World: a thin holder for the scenario's signed-in browser pages.
// Steps drive page objects (support/pages/); they never see a selector or a
// URL. Lines marked PROJECT: are the ones each project fills in.

const fs = require('node:fs');
const path = require('node:path');
const { setWorldConstructor, setDefaultTimeout, Before, BeforeAll, After, AfterAll } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const { BASE_URL } = require('./stack');
const { ADMIN, api, disposeApi, signedInState } = require('./auth');

// For a person watching or debugging; agents and CI set none of these, and
// browser checks run headless.
// HEADED=1: a visible browser, slowed down so each action can be followed.
// PWDEBUG=1: Playwright's Inspector, pausing before each action (headed).
// VIDEO=1: a slowed-down video of every scenario in reports/videos/, headless.
const HEADED = process.env.HEADED === '1';
const PWDEBUG = Boolean(process.env.PWDEBUG) && process.env.PWDEBUG !== '0';
const VIDEO = process.env.VIDEO === '1';
// How slow a VIDEO=1 run is, in ms per browser action.
const VIDEO_SLOWMO = Number(process.env.VIDEO_SLOWMO ?? 400);
// Step captions over the pages, only when recording review videos.
const { showCaption } = VIDEO ? require('./captions') : { showCaption: null };
setDefaultTimeout(PWDEBUG ? -1 : HEADED || VIDEO ? 300_000 : 60_000);

// In CI (or with TRACE=1) every context is traced; a failed scenario's traces
// are kept, the rest discarded. Open one with `npx playwright show-trace
// <zip>`. Locally a failure is simply rerun, so tracing's cost isn't paid.
const TRACE = Boolean(process.env.CI) || process.env.TRACE === '1';
const REPORTS = path.resolve(__dirname, '../reports');
const TRACES = path.join(REPORTS, 'traces');
const VIDEOS = path.join(REPORTS, 'videos');
const VIDEO_SCRATCH = path.join(VIDEOS, '.recording');

// The desktop screen is the UI verifier's width (ui_verifier_width in
// .copier-answers.yml); a phone is 375px wide.
function verifierWidth() {
  try {
    const answers = fs.readFileSync(path.resolve(__dirname, '../../.copier-answers.yml'), 'utf8');
    return Number(/^ui_verifier_width:\s*(\d+)\s*$/m.exec(answers)?.[1]) || 1280;
  } catch {
    return 1280;
  }
}
const DESKTOP = { width: verifierWidth(), height: 900 };
const PHONE = { width: 375, height: 812 };

let browser = null;

function launchOptions() {
  if (PWDEBUG) return { headless: false }; // the Inspector does the pausing
  if (HEADED) return { headless: false, slowMo: 400 };
  if (VIDEO) return { headless: true, slowMo: VIDEO_SLOWMO };
  return { headless: true };
}

async function launch() {
  browser ??= await chromium.launch(launchOptions());
  return browser;
}

/** "The list shows 3 more" -> "the-list-shows-3-more" */
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

let scenarioCount = 0; // run order, for the videos' names
const signedInStates = new Map(); // user -> storageState, captured once per run

class AcceptanceWorld {
  constructor({ attach }) {
    this.attach = attach;
    this.viewport = DESKTOP;
    this.scenario = null; // { order, slug, name }, set before each scenario
    this.pages = new Map(); // who ('the user', 'a colleague') -> page
    this.contexts = []; // { who, label, context, page } for every browser context opened, in order
    this.caption = null; // VIDEO=1: the step being run, as written
  }

  /** A browser context for one of the scenario's people: traced, and recorded with VIDEO=1. */
  async newPage(who, label, storageState) {
    const context = await (await launch()).newContext({
      baseURL: BASE_URL,
      storageState,
      viewport: this.viewport,
      ...(VIDEO ? { recordVideo: { dir: VIDEO_SCRATCH, size: this.viewport } } : {}),
    });
    if (TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    if (showCaption) {
      // A page opened mid-scenario, or one that navigates, shows the current step too.
      page.on('domcontentloaded', () => showCaption(page, this.caption));
    }
    this.contexts.push({ who, label, context, page });
    return page;
  }

  /** That person's page, already signed in through the API (support/auth.js). */
  async signedIn(who, { user, password } = ADMIN) {
    if (this.pages.has(who)) return this.pages.get(who);
    if (!signedInStates.has(user)) signedInStates.set(user, await signedInState(user, password));
    const page = await this.newPage(slug(who), who, signedInStates.get(user));
    this.pages.set(who, page);
    return page;
  }

  /** A page for someone not signed in: the only way a sign-in scenario starts. */
  async signedOut(who = 'visitor') {
    if (this.pages.has(who)) return this.pages.get(who);
    const page = await this.newPage(slug(who), who);
    this.pages.set(who, page);
    return page;
  }

  /** The scenario's open pages (captions.js puts each step's caption on all of them). */
  openPages() {
    return [...this.pages.values()];
  }

  /** Every page of this scenario, open now or later, is on a phone-sized screen. */
  async usePhone() {
    this.viewport = PHONE;
    for (const page of this.pages.values()) await page.setViewportSize(PHONE);
  }

  /** Runs setup through the run's API session. */
  async withApi(fn) {
    return fn(await api());
  }

  // PROJECT: helpers for setup the scenarios share (create a person with
  // roles, a record, a fixture), each through withApi().
}

setWorldConstructor(AcceptanceWorld);

BeforeAll(function () {
  // Only this run's traces are in reports/. Videos are replaced only by a run
  // that records new ones, so a later run doesn't delete the ones to review.
  fs.rmSync(TRACES, { recursive: true, force: true });
  if (VIDEO) fs.rmSync(VIDEOS, { recursive: true, force: true });
});

Before(function ({ pickle }) {
  scenarioCount += 1;
  this.scenario = { order: String(scenarioCount).padStart(2, '0'), slug: slug(pickle.name), name: pickle.name };
});

After(async function ({ result }) {
  const failed = result?.status === 'FAILED';
  if (failed) {
    for (const page of this.pages.values()) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) this.attach(shot, 'image/png');
    }
  }
  // "<slug>" when the scenario opened one browser, "<slug>-<who>" for each when more.
  const name = (who) => (this.contexts.length > 1 ? `${this.scenario.slug}-${who}` : this.scenario.slug);
  for (const { who, label, context, page } of this.contexts) {
    if (TRACE && failed) {
      fs.mkdirSync(TRACES, { recursive: true });
      await context.tracing.stop({ path: path.join(TRACES, `${name(who)}.zip`) });
    } else if (TRACE) {
      await context.tracing.stop();
    }
    const video = VIDEO ? page.video() : null;
    await context.close();
    if (video) {
      const file = `${this.scenario.order}-${name(who)}.webm`;
      await video.saveAs(path.join(VIDEOS, file));
      await video.delete();
      // What `npm run video:journey` puts on each clip's title card.
      const entry = { file, order: this.scenario.order, scenario: this.scenario.name, who: label };
      fs.appendFileSync(path.join(VIDEOS, 'clips.jsonl'), `${JSON.stringify(entry)}\n`);
    }
  }
});

AfterAll(async function () {
  await disposeApi();
  await browser?.close();
  fs.rmSync(VIDEO_SCRATCH, { recursive: true, force: true });
});
