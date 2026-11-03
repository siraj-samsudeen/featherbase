'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { expect } = require('playwright/test');
const { Api, SYSTEM_MANAGER, signedInState } = require('../api');
const { resetAcceptance, acceptanceSql, isolatedEnvironment, REPO_ROOT } = require('../stack');

const ADMIN = '/featherbase/admin';
const SETUP = `${ADMIN}/setup`;
const HEALTH = `${ADMIN}/instance-health`;
const APPS = `${ADMIN}/apps`;

// A real, disposable source checkout for source-only, broken-build and empty
// catalog cases. Never remove shared artifacts or change a packaged manifest.
function sourceCheckout(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'featherbase-base-install-'));
  const copy = (relative) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, relative), path.join(root, relative), {
      recursive: true, preserveTimestamps: true,
      filter: file => !['node_modules', 'dist', 'coverage', '.git'].includes(path.basename(file)),
    });
  };
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'apps/server', 'packages', 'tools']) copy(file);
  for (const relative of ['node_modules', 'apps/server/node_modules', 'packages/shared/node_modules']) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // pnpm 12 refreshes workspace links/shims during run and writes task state.
    // Isolate all writable dependencies, retaining their internal relative links.
    fs.cpSync(path.join(REPO_ROOT, relative), target, {
      recursive: true, verbatimSymlinks: true,
      filter: file => !path.basename(file).startsWith('.pnpm-task-run-state-'),
    });
  }
  if (mode !== 'empty') {
    fs.writeFileSync(path.join(root, '.git'), 'Acceptance-only source checkout marker\n');
    for (const relative of ['example-apps/tasker', 'client-apps/jeyarama/dash']) {
      copy(relative);
      const modules = path.join(REPO_ROOT, relative, 'node_modules');
      // npm ci may replace this directory. It must never operate through a
      // link into another worker's installed app dependencies.
      if (fs.existsSync(modules)) fs.cpSync(modules, path.join(root, relative, 'node_modules'), { recursive: true, preserveTimestamps: true });
    }
    // A genuinely damaged source package: declarations are untouched, but its
    // required compiler configuration is missing. Its real build must fail.
    if (mode === 'broken') fs.rmSync(path.join(root, 'example-apps/tasker/tsconfig.json'));
  }
  return root;
}

class BaseInstall {
  constructor(world) { this.world = world; this.env = isolatedEnvironment({ FEATHERBASE_ENV: 'development' }); }

  async fresh({ hosted = false, managed = false, source } = {}) {
    if (source) this.scratch = sourceCheckout(source);
    this.env = isolatedEnvironment({ FEATHERBASE_ENV: hosted ? 'test' : 'development', FEATHERBASE_INSTANCE: managed ? 'acceptance/local' : '' });
    await Api.disposeAll();
    await resetAcceptance(this.env, this.scratch ?? REPO_ROOT);
    this.api = await Api.asSystemManager();
  }

  async close() { if (this.scratch) fs.rmSync(this.scratch, { recursive: true, force: true }); }

  async call(method, route, data, statuses = [200]) {
    const response = await this.api.call(method, route, data, statuses, `${method} ${route}`);
    return response.json();
  }
  async catalog() { return (await this.call('GET', '/api/apps')).catalog; }
  async app(name = 'tasker') {
    const app = (await this.catalog()).find(app => app.name === name);
    assert.ok(app, `${name} must be available from a real trusted package`);
    return app;
  }
  async ensureAvailable() { await this.app(); }
  async assertNeverApplied() {
    assert.equal((await acceptanceSql('select * from featherbase.instance_settings_apply')).length, 0);
  }
  async attemptForbiddenInstall() {
    const response = await this.page.request.post('/api/install_app', { data: { name: 'tasker' } });
    this.deniedStatus = response.status();
  }
  async detailsAlongsideList() {
    await this.page.getByRole('navigation', { name: 'Available apps' }).waitFor();
    await this.detailsContain('What it adds');
    await this.detailsContain((await this.app()).installed ? 'Installed' : 'Not installed');
  }
  async installActionClear() {
    await this.details().getByRole('button', { name: /^(Prepare and install|Install app)$/ }).waitFor();
  }
  async configurationReachable() {
    await this.details().getByRole('link', { name: 'Configure role mappings', exact: true }).waitFor();
    await this.details().getByRole('link', { name: 'Configure settings', exact: true }).click();
    await this.page.waitForURL('**/App%20Setting?*');
  }
  async preparationSucceeded() {
    await this.page.getByRole('status').filter({ hasText: 'Preparing the package' }).waitFor();
    assert.equal((await this.app()).installed, false, 'the package must not be installed while its build is running');
    await this.finishInstall();
    assert.equal((await this.app()).preparation.state, 'ready');
  }
  async preparationFailed() {
    const response = await this.installResponse;
    assert.ok(response.status() >= 400);
    const app = await this.app();
    assert.equal(app.installed, false);
    assert.equal(app.preparation.state, 'failed');
    await this.detailsContain('Ask the operator');
    await this.detailsContain('Not installed');
  }
  async welcomeSteps() {
    await this.page.getByRole('heading', { name: 'Welcome to Featherbase' }).waitFor();
    for (const name of ['1. Set up your administrators', '2. Choose your apps', '3. Prepare for shared use']) await this.page.getByRole('heading', { name, exact: true }).waitFor();
  }
  async exploring() {
    await this.page.waitForURL(`**${ADMIN}/all-tables`);
    await this.page.getByTestId('top-bar-name').waitFor();
  }
  async savedDestination() { assert.equal(new URL(this.page.url()).pathname, this.destination); }
  async enableInvitations() {
    const ids = await this.api.rowIds('Sign In Method', 20);
    for (const id of ids) {
      const row = await this.api.row('Sign In Method', id);
      if (row.kind === 'google') {
        await this.call('POST', '/api/save_row', { table: 'Sign In Method', row: { ...row, enabled: true } }, [200, 201]);
        return;
      }
    }
    throw new Error('The platform must provide the Google sign-in method for invitations');
  }
  async install(name = 'tasker') {
    const app = await this.app(name);
    if (!app.installed) await this.call('POST', app.preparation.state === 'ready' ? '/api/install_app' : '/api/apps/prepare-install', { name }, [201]);
    // The scenario's working actor is explicitly admitted after installation;
    // installing an app itself grants nobody access to private work.
    if (name === 'tasker') {
      const person = await this.api.row('Person', SYSTEM_MANAGER.user);
      if (!person.roles.some(entry => entry.role === 'Tasker Member'))
        await this.api.saveRow('Person', {
          row_id: person.row_id, updated_at: person.updated_at,
          roles: [...person.roles, { role: 'Tasker Member' }],
        });
    }
  }
  async manager() {
    if (!this.page) {
      ({ page: this.page } = await this.world.newPage('base-administrator', 'Administrator', await signedInState(SYSTEM_MANAGER.user, SYSTEM_MANAGER.password)));
      this.world.page = this.page;
    }
    return this.page;
  }
  async colleague() {
    await this.world.person('the user', []);
    this.page = await this.world.signedIn('the user');
  }
  async open(route = ADMIN) { await (await this.manager()).goto(route); }
  async textContains(text) {
    await this.page.getByText(text, { exact: false }).first().waitFor();
  }
  async inspect(name = 'tasker') {
    await this.open(APPS);
    await this.page.getByRole('navigation', { name: 'Available apps' }).getByRole('button', { name: name === 'tasker' ? /Tasker/ : /Feather Dash/ }).click();
  }
  details(name = 'Tasker') { return this.page.getByLabel(`${name} details`); }
  async detailsContain(text, name) {
    await this.details(name).getByText(text, { exact: false }).first().waitFor();
  }
  async inspectAvailable() { await this.open(APPS); }
  async chooseInstall() {
    await this.inspect();
    this.installResponse = this.page.waitForResponse(response => response.request().method() === 'POST' && ['/api/apps/prepare-install', '/api/install_app'].some(route => response.url().endsWith(route)), { timeout: 180_000 });
    await this.details().getByRole('button', { name: /^(Prepare and install|Install app)$/ }).click();
  }
  async finishInstall() {
    const response = await this.installResponse;
    assert.equal(response.status(), 201, await response.text());
    await this.detailsContain('Installed on this instance');
    assert.equal((await this.app()).installed, true);
  }
  async preparationsShown() {
    for (const name of ['Tasker', 'Feather Dash']) {
      const button = this.page.getByRole('navigation', { name: 'Available apps' }).getByRole('button', { name: new RegExp(name) });
      assert.match(await button.innerText(), /Needs preparation/);
    }
    for (const app of await this.catalog()) if (['tasker', 'feather_dash'].includes(app.name)) assert.equal(app.preparation.state, 'needed');
  }
  async noInstalledApps() {
    const result = await this.call('GET', '/api/apps');
    assert.deepEqual(result.installed, []);
    const tables = await acceptanceSql("select table_name from information_schema.tables where table_schema = 'featherbase' and (table_name like 'tasker.%' or table_name like 'feather_dash.%')");
    assert.equal(tables.length, 0);
  }
  async noFixtures() {
    const names = (await this.catalog()).map(app => app.name);
    const fixtures = fs.readdirSync(path.join(REPO_ROOT, 'test-apps'), { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      const manifest = path.join(REPO_ROOT, 'test-apps', entry.name, 'featherbase.json');
      return fs.existsSync(manifest) ? [JSON.parse(fs.readFileSync(manifest)).name] : [];
    });
    for (const fixture of fixtures) assert.ok(!names.includes(fixture), `test fixture ${fixture} must not be offered`);
  }
  async health() {
    this.report = await this.call('GET', '/api/instance-health');
    await this.open(HEALTH);
    await this.page.getByTestId('instance-health-summary').waitFor();
  }
  check(key) {
    const check = this.report.checks.find(check => check.key === key);
    assert.ok(check, `health report must include ${key}`);
    return check;
  }
  async ready() {
    assert.equal(this.report.failing, 0);
    assert.equal(this.report.setup_needed, 0);
    await this.textContains('Ready to explore');
  }
  async optionalConfiguration() {
    assert.equal(this.check('settings-applied').state, 'optional');
    await this.page.getByTestId('health-check-settings-applied').getByText('Optional', { exact: true }).waitFor();
  }
  async hostedReadiness() {
    const check = this.check('system-manager-email');
    assert.equal(check.state, 'setup-needed');
    assert.ok(check.fix);
    assert.ok(this.report.setup_needed > 0);
    await this.textContains('Complete the required setup before shared use');
  }
  async failedJob() {
    // The boot-time queue entry must not immediately overwrite the arranged
    // last-run failure while the browser is reading it.
    await acceptanceSql("update featherbase.background_job set run_at = now() + interval '1 day' where method = 'check_instance_health' and job_status = 'queued'");
    const rows = await acceptanceSql("update featherbase.scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error', last_result = 'Acceptance operational failure' where method = 'check_instance_health' returning method");
    assert.equal(rows.length, 1, 'the platform health job must exist');
  }
  async banner(visible = true) {
    const banner = this.page.getByTestId('health-banner');
    if (visible) {
      await banner.waitFor();
      await banner.getByRole('link', { name: 'Open instance health' }).waitFor();
      const report = await this.call('GET', '/api/instance-health');
      assert.ok(report.checks.some(check => check.key === 'scheduled-job:check_instance_health' && check.state === 'fault'));
      assert.equal(report.failing, 1, 'unfinished setup must not inflate the operational fault count');
    } else {
      await this.page.getByTestId('top-bar-name').waitFor();
      assert.equal(await banner.count(), 0);
    }
  }
  async recoverJob() {
    await this.open(SETUP);
    await this.banner();
    const { name } = await this.call('POST', '/api/enqueue_job', { method: 'check_instance_health' }, [201]);
    const deadline = Date.now() + 15_000;
    let outcome;
    do {
      const executions = await acceptanceSql('select outcome from featherbase.job_execution where job = $1', [name]);
      outcome = executions[0]?.outcome;
      if (outcome) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(outcome, 'success', 'the real background worker must complete a later successful run');
    await this.page.reload();
    await this.page.getByTestId('welcome-setup').waitFor();
    await this.page.getByTestId('health-banner').waitFor({ state: 'hidden' });
  }
  async applySettings(settings) {
    return this.call('POST', '/api/instance-settings/apply', { file: { settings } });
  }
  async appliedConfiguration() { await this.applySettings({ 'System Settings': { app_name: 'Acceptance Featherbase' } }); }
  async drift() {
    const result = await this.command(['advanced', 'settings', 'settings:set', 'app_name', '--stdin'], 'Emergency Featherbase');
    assert.equal(result.status, 0, result.stderr);
  }
  async configurationFinding(key) {
    const check = this.check(key);
    assert.ok(['fault', 'setup-needed'].includes(check.state));
    assert.ok(check.fix);
    const card = this.page.getByTestId(`health-check-${key}`);
    await card.getByTestId('health-fix').waitFor();
    assert.match(await card.innerText(), key === 'settings-applied' ? /apply/i : /app_name/);
  }
  async welcome() { await this.open(SETUP); await this.page.getByRole('heading', { name: 'Welcome to Featherbase' }).waitFor(); }
  async signIn(deep = false) {
    if (deep) await this.install();
    ({ page: this.page } = await this.world.newPage('first-administrator', 'First administrator'));
    this.world.page = this.page;
    this.destination = '/tasker/';
    await this.page.goto(deep ? `/featherbase/login?next=${encodeURIComponent(this.destination)}` : '/login');
    await this.page.locator('input[name=email]').fill(SYSTEM_MANAGER.user);
    await this.page.locator('input[name=password]').fill(SYSTEM_MANAGER.password);
    await this.page.getByTestId('login-submit').click();
    await this.page.waitForURL(deep ? `**${this.destination}` : `**${SETUP}`);
  }
  async explore() {
    await this.page.getByRole('link', { name: 'Explore Featherbase', exact: true }).click();
    await this.page.waitForURL(`**${ADMIN}/all-tables`);
    await this.noInstalledApps();
  }
  async skip() { await this.welcome(); await this.page.getByRole('link', { name: 'Explore Featherbase', exact: true }).click(); }
  async resumeSetup() {
    await this.welcome();
    await this.page.getByRole('link', { name: 'Manage people' }).waitFor();
    const report = await this.call('GET', '/api/instance-health');
    assert.equal(report.setup.installed_apps, 1);
    await this.textContains('1 installed');
    await this.page.getByRole('link', { name: 'Set up administrators' }).waitFor();
  }
  async invite() {
    await this.open(`${SETUP}/people`);
    await this.page.getByLabel('Full name', { exact: true }).fill('Acceptance administrator');
    await this.page.getByLabel('Email', { exact: true }).fill('base-install-admin@example.com');
    await this.page.getByRole('button', { name: 'Invite', exact: true }).click();
  }
  async invitation() {
    const invitation = this.page.getByTestId('setup-invitation');
    await invitation.waitFor();
    assert.match(await invitation.innerText(), /https?:\/\//);
    await invitation.getByRole('button', { name: 'Copy', exact: true }).waitFor();
  }
  async switcher(inTasker = false) {
    await this.open(inTasker ? '/tasker/' : ADMIN);
    await this.page.getByRole('combobox', { name: 'Switch application' }).waitFor();
  }
  async platformName() {
    const options = this.page.getByRole('combobox', { name: 'Switch application' }).locator('option');
    await expect.poll(() => options.allTextContents()).toContain('Featherbase');
  }
  async taskerName() {
    const options = this.page.getByRole('combobox', { name: 'Switch application' }).locator('option');
    await expect.poll(() => options.allTextContents()).toContain('Tasker');
  }
  async configureDash() {
    await this.inspect('feather_dash');
    await this.details('Feather Dash').getByRole('link', { name: 'Configure settings', exact: true }).click();
  }
  async manageDashIdentifier() {
    await this.applySettings({ 'App Setting': [{ row_id: 'feather_dash.dive_id', value: 'acceptance-report' }] });
    await this.call('POST', '/api/save_row', { table: 'App Setting', row: { row_id: 'feather_dash.dive_version', value: 'initial-version' } }, [201]);
  }
  async editableVersion() {
    await this.open(`${ADMIN}/App%20Setting/feather_dash.dive_version`);
    const input = this.page.getByLabel('Value', { exact: true });
    assert.equal(await input.isEnabled(), true);
    await input.fill('acceptance-version');
    const saved = this.page.waitForResponse(response => response.url().endsWith('/api/save_row') && response.request().method() === 'POST');
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await saved;
    assert.ok(response.ok(), await response.text());
    const row = await this.api.row('App Setting', 'feather_dash.dive_version');
    assert.equal(row.value, 'acceptance-version');
  }
  async lockedIdentifier() {
    await this.open(`${ADMIN}/App%20Setting/feather_dash.dive_id`);
    const input = this.page.getByLabel('Value', { exact: true });
    await input.waitFor();
    assert.ok(await input.isDisabled() || await input.getAttribute('readonly') !== null);
    await this.textContains('settings file');
  }
  async readOnlyDeclaration() {
    await this.inspect('feather_dash');
    await this.detailsContain('packaged declarations are read-only', 'Feather Dash');
    assert.equal(await this.details('Feather Dash').locator('input,textarea').count(), 0);
  }
  async missingSecret() {
    const app = await this.app('feather_dash');
    assert.deepEqual(app.secrets.find(secret => secret.name === 'MOTHERDUCK_TOKEN'), { name: 'MOTHERDUCK_TOKEN', optional: false, present: false });
    await this.detailsContain('MOTHERDUCK_TOKEN', 'Feather Dash');
    await this.detailsContain('Missing', 'Feather Dash');
  }
  async secretsAbsent() {
    const json = JSON.stringify(await this.catalog());
    assert.ok(!json.includes('acceptance-private-secret'));
    for (const app of await this.catalog()) for (const secret of app.secrets) assert.deepEqual(Object.keys(secret).sort(), ['name', 'optional', 'present']);
  }
  async command(args, input) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['tools/featherbase.mjs', ...args], {
        cwd: REPO_ROOT, env: {
          ...this.env,
          API_PORT: String(Number(this.env.API_PORT) + 1),
          WEB_PORT: String(Number(this.env.WEB_PORT) + 1),
          PORT: String(Number(this.env.API_PORT) + 1),
        },
        stdio: ['pipe', 'pipe', 'pipe'], timeout: 180_000,
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', status => resolve({ status, stdout, stderr }));
      child.stdin.end(input);
    });
  }
  async cliHealth(json = false) {
    this.result = await this.command(['health', ...(json ? ['--json'] : [])]);
    if (json) this.report = JSON.parse(this.result.stdout.trim());
  }
  async prepare() { this.result = await this.command(['setup']); assert.equal(this.result.status, 0, this.result.stderr); }
  async seedTask() {
    await this.install();
    const app = await this.app();
    const response = await this.api.ctx.post('/api/save_row', {
      headers: { ...this.api.headers, 'X-Featherbase-App-Version': `tasker@${app.version}` },
      data: { table: 'tasker.task', row: { task_title: 'Preserve this acceptance task' } },
    });
    assert.equal(response.status(), 201, await response.text());
    this.savedTask = await response.json();
  }
  async preserved() {
    const app = await this.app();
    assert.equal(app.installed, true);
    const response = await this.api.ctx.get(`/api/table/tasker.task/${encodeURIComponent(this.savedTask.row_id)}`, {
      headers: { ...this.api.headers, 'X-Featherbase-App-Version': `tasker@${app.version}` },
    });
    assert.equal(response.status(), 200, await response.text());
    assert.equal((await response.json()).task_title, 'Preserve this acceptance task');
  }
  artifactSnapshot() {
    const entries = [];
    const visit = directory => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isDirectory()) visit(file);
        else if (file.includes(`${path.sep}dist${path.sep}`)) entries.push([file, fs.statSync(file).mtimeMs, fs.statSync(file).size]);
      }
    };
    visit(path.join(REPO_ROOT, 'client-apps')); visit(path.join(REPO_ROOT, 'test-apps'));
    return entries;
  }
  async start() {
    this.beforeArtifacts = this.artifactSnapshot();
    this.result = await this.command(['start', '--check']);
    assert.equal(this.result.status, 0, this.result.stderr + this.result.stdout);
  }
  async unchangedArtifacts() { assert.deepEqual(this.artifactSnapshot(), this.beforeArtifacts); }
}

module.exports = { BaseInstall };
