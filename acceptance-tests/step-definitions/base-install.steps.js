'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { BaseInstall } = require('../support/pages/base-install');

async function fresh(world, options) {
  world.baseInstall = new BaseInstall(world);
  await world.baseInstall.fresh(options);
}

After(async function () { await this.baseInstall?.close(); });

Given('the user is a System Manager on an instance with no installed apps', async function () { await fresh(this); });
Given('Tasker is available on the server', async function () { await this.baseInstall.ensureAvailable(); });
Given('the checkout includes unbuilt Tasker and client app Dash packages', { timeout: 180_000 }, async function () { await this.baseInstall.fresh({ source: 'unbuilt' }); });
Given('the user is a System Manager viewing the available app list', async function () { await fresh(this); await this.baseInstall.inspectAvailable(); });
Given('the user is a System Manager on an instance with no available apps', { timeout: 180_000 }, async function () { await fresh(this, { source: 'empty' }); });
Given('the user is a System Manager viewing an unbuilt Tasker package', { timeout: 180_000 }, async function () { await fresh(this, { source: 'unbuilt' }); await this.baseInstall.inspect(); });
Given('the user is a System Manager viewing a Tasker package that cannot be built', { timeout: 180_000 }, async function () { await fresh(this, { source: 'broken' }); await this.baseInstall.inspect(); });
Given('the user is a colleague without System Manager access', async function () { await fresh(this); await this.baseInstall.colleague(); });
Given('the user is a System Manager with Dash installed', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.install('feather_dash'); });
Given('its report identifier is file-managed while its report account is editable', async function () { await this.baseInstall.manageDashIdentifier(); });
Given('its required warehouse secret has not been supplied by the operator', function () { assert.equal(this.baseInstall.env.MOTHERDUCK_TOKEN, ''); });
Given('the user is a System Manager with Tasker installed', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.install(); });

When('the user inspects Tasker', async function () { await this.baseInstall.inspect(); });
When('the user inspects the available apps', async function () { await this.baseInstall.inspectAvailable(); });
When('the user chooses Tasker from the list', async function () { await this.baseInstall.inspect(); });
When('the user chooses to install Tasker', async function () { await this.baseInstall.chooseInstall(); });
When('the user explicitly chooses to prepare and install Tasker', async function () { await this.baseInstall.chooseInstall(); });
When('the user tries to install Tasker', async function () { await this.baseInstall.attemptForbiddenInstall(); });
When('the user configures Dash', async function () { await this.baseInstall.configureDash(); });
When("the user inspects Dash's setup", async function () { await this.baseInstall.inspect('feather_dash'); });

Then('the user sees its version, required platform version, additions, permissions and setup requirements', async function () {
  const app = await this.baseInstall.app();
  for (const text of [app.version, app.platformVersion, 'What it adds', 'Permissions', 'Instance setup']) await this.baseInstall.detailsContain(text);
});
Then('Tasker is identified as not installed', async function () { assert.equal((await this.baseInstall.app()).installed, false); await this.baseInstall.detailsContain('Not installed'); });
Then('both Tasker and Dash can be inspected', async function () { await this.baseInstall.inspect(); await this.baseInstall.detailsContain('Tasker'); await this.baseInstall.inspect('feather_dash'); await this.baseInstall.detailsContain('Dash', 'Dash'); });
Then('the user can tell that each package needs preparation before installation', async function () { await this.baseInstall.preparationsShown(); });
Then('neither app is installed automatically', async function () { await this.baseInstall.noInstalledApps(); });
Then('test fixtures are not offered as user apps', async function () { await this.baseInstall.noFixtures(); });
Then("Tasker's declarations and installation state are shown alongside the list", async function () { await this.baseInstall.detailsAlongsideList(); });
Then('the applicable preparation or installation action is clear', async function () { await this.baseInstall.installActionClear(); });
Then('the user is told how an operator makes a trusted app available', async function () { await this.baseInstall.textContains('No apps available'); await this.baseInstall.textContains('operator to supply a trusted app package'); });
Then('Tasker is identified as installed', { timeout: 180_000 }, async function () { await this.baseInstall.finishInstall(); });
Then('the user can reach its instance configuration', async function () { await this.baseInstall.configurationReachable(); });
Then('preparation progress is shown and Tasker is installed only after preparation succeeds', { timeout: 180_000 }, async function () { await this.baseInstall.preparationSucceeded(); });
Then('Tasker remains uninstalled and the failure explains what to do next', { timeout: 180_000 }, async function () { await this.baseInstall.preparationFailed(); });
Then('the user is refused', function () { assert.equal(this.baseInstall.deniedStatus, 403); });
Then('Tasker remains uninstalled', async function () { assert.equal((await this.baseInstall.app()).installed, false); });
Then('the user can change the report account', async function () { await this.baseInstall.editableAccount(); });
Then('the report identifier is locked with an explanation', async function () { await this.baseInstall.lockedIdentifier(); });
Then("the app's packaged declaration is not editable", async function () { await this.baseInstall.readOnlyDeclaration(); });
Then("the user sees the secret's name and that it is missing", async function () { await this.baseInstall.missingSecret(); });
Then('the user is directed to supply it through the host environment', async function () { await this.baseInstall.detailsContain('host environment', 'Dash'); });
Then('no secret value is returned to the browser', async function () { await this.baseInstall.secretsAbsent(); });

Given('the user has a new local instance using built-in defaults', async function () { await fresh(this); });
Given('the user has a local development instance without email or a warehouse', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.install('feather_dash'); });
Given('the user has a hosted instance missing required notice recipients', async function () { await fresh(this, { hosted: true }); });
Given('the user has chosen file-managed configuration for an instance', async function () { await fresh(this, { managed: true }); });
Given('its settings file has never been successfully applied', async function () { await this.baseInstall.assertNeverApplied(); });
Given('the user has applied file-managed configuration to an instance', async function () { await fresh(this); await this.baseInstall.appliedConfiguration(); });
Given('a managed setting was changed through an emergency operation', async function () { await this.baseInstall.drift(); });
Given('the user is a System Manager who has not finished first-time setup', async function () { await fresh(this); });
Given('the last run of an enabled scheduled job failed', async function () { await this.baseInstall.failedJob(); });
Given('an enabled scheduled job has failed', async function () { await this.baseInstall.failedJob(); });
Given('the user does not have the System Manager role', async function () { await fresh(this); await this.baseInstall.colleague(); });
Given('the user is the first administrator on a fresh local instance', async function () { await fresh(this); });
Given('the user has deferred optional first-time setup', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.install(); await this.baseInstall.skip(); });
Given('the user is the first administrator with setup unfinished', async function () { await fresh(this); });
Given('the user is the first administrator on an instance that cannot send email', async function () { await fresh(this); await this.baseInstall.enableInvitations(); });

When('the user checks its health', async function () { await this.baseInstall.health(); });
When('the user opens Featherbase', async function () { await this.baseInstall.open(); });
When('the user signs in', async function () { await this.baseInstall.signIn(); });
When('the user returns to the setup guide', async function () { await this.baseInstall.welcome(); });
When('the user skips first-time setup', async function () { await this.baseInstall.skip(); });
When('the user invites another System Manager during setup', async function () { await this.baseInstall.invite(); });
When('the user signs in to follow a saved app link', async function () { await this.baseInstall.signIn(true); });

Then('the user is told the instance is ready to explore', async function () { await this.baseInstall.ready(); });
Then('choosing a managed settings file is offered as an optional next step, not a fault', async function () { await this.baseInstall.optionalConfiguration(); });
Then('absent optional services are explained without being counted as operational faults', async function () { assert.equal(this.baseInstall.report.failing, 0); await this.baseInstall.textContains('development'); });
Then('any installed app still identifies the setup it needs', async function () { const check = this.baseInstall.check('app-setup:feather_dash'); assert.ok(check.missing.includes('secret MOTHERDUCK_TOKEN')); await this.baseInstall.textContains('MOTHERDUCK_TOKEN'); });
Then('the user sees that shared use is not ready and how to complete that setup', async function () { await this.baseInstall.hostedReadiness(); });
Then('the unapplied configuration is reported with the action needed to apply it', async function () { await this.baseInstall.configurationFinding('settings-applied'); });
Then('the differing setting is reported with the action needed to reconcile it', async function () { await this.baseInstall.configurationFinding('settings-match-file'); });
Then('the job failure is visibly reported separately from setup guidance', async function () { await this.baseInstall.banner(); await this.baseInstall.welcome(); await this.baseInstall.banner(); });
Then('the notice remains until a later run succeeds', async function () { await this.baseInstall.recoverJob(); });
Then('the user does not see instance administration notices', async function () { await this.baseInstall.banner(false); });
Then('the user sees a welcome guide with clear next steps', async function () { await this.baseInstall.welcomeSteps(); });
Then('the user can explore Featherbase without installing an app', async function () { await this.baseInstall.explore(); });
Then('the greeting does not present ordinary unfinished setup as health problems', async function () { await this.baseInstall.banner(false); });
Then('completed configuration is reflected and remaining steps can be continued', async function () { await this.baseInstall.resumeSetup(); });
Then('the user reaches Featherbase immediately', async function () { await this.baseInstall.exploring(); });
Then('the operational failure remains visibly reported', async function () { await this.baseInstall.banner(); });
Then('the invitation link is shown to copy and deliver separately', async function () { await this.baseInstall.invitation(); });
Then('the saved destination is preserved', async function () { await this.baseInstall.savedDestination(); });
Then('the user can open the setup guide separately', async function () { await this.baseInstall.welcome(); });

Given('the user has a fresh checkout and an empty development instance', async function () { await fresh(this); });
Given('the user has explicitly installed Tasker on a development instance', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.seedTask(); });
Given('the user has prepared a local Featherbase instance', { timeout: 180_000 }, async function () { await fresh(this); await this.baseInstall.prepare(); await this.baseInstall.seedTask(); });
Given('the user has a local instance with an enabled scheduled job whose last run failed', async function () { await fresh(this); await this.baseInstall.failedJob(); });
When('the user starts Featherbase without choosing an instance or any apps', { timeout: 240_000 }, async function () { await this.baseInstall.start(); });
When('the user starts Featherbase again without choosing an instance or any apps', { timeout: 240_000 }, async function () { await this.baseInstall.start(); });
When('the user runs the preparation command again', { timeout: 180_000 }, async function () { await this.baseInstall.prepare(); });
When('the user checks its health from the command line', async function () { await this.baseInstall.cliHealth(); });
When('the user requests a machine-readable command-line health report', async function () { await this.baseInstall.cliHealth(true); });
Then('the user can sign in to Featherbase', async function () { await this.baseInstall.signIn(); });
Then('no example app, client app or test app is installed', async function () { await this.baseInstall.noInstalledApps(); });
Then('no client app or test app was built by the startup command', async function () { await this.baseInstall.unchangedArtifacts(); });
Then('Tasker and its existing tasks are still installed', async function () { await this.baseInstall.preserved(); });
Then('existing data and installed apps are preserved', async function () { await this.baseInstall.preserved(); });
Then('the user is told what changed and how to start the instance', function () { assert.match(this.baseInstall.result.stdout, /schema is up to date/); assert.match(this.baseInstall.result.stdout, /Next: featherbase start/); });
Then('the report succeeds and says it is ready to explore', function () { assert.equal(this.baseInstall.result.status, 0, this.baseInstall.result.stderr); assert.match(this.baseInstall.result.stdout, /ready to explore/); });
Then('optional configuration is reported separately from faults', function () { assert.match(this.baseInstall.result.stdout, /optional: Settings file applied/); assert.doesNotMatch(this.baseInstall.result.stdout, /^fault:/m); });
Then('the command fails and the report identifies the failed check and next action', function () { assert.equal(this.baseInstall.result.status, 1); const check = this.baseInstall.check('scheduled-job:check_instance_health'); assert.equal(check.state, 'fault'); assert.ok(check.fix); });
Then('the report does not contain secret values', function () { assert.ok(!this.baseInstall.result.stdout.includes('acceptance-private-secret')); assert.ok(!this.baseInstall.result.stdout.includes(this.baseInstall.env.DATABASE_URL)); });
Then('the command fails with a setup-readiness finding and the next action', function () { assert.equal(this.baseInstall.result.status, 1); const check = this.baseInstall.check('system-manager-email'); assert.equal(check.state, 'setup-needed'); assert.ok(check.fix); });
Then('the missing setup is distinguished from an operational fault', function () { assert.equal(this.baseInstall.report.failing, 0); assert.ok(this.baseInstall.report.setup_needed > 0); });
When('the user inspects the destination switcher', async function () { await this.baseInstall.switcher(); });
When('the user inspects the destination switcher while using Tasker', async function () { await this.baseInstall.switcher(true); });
Then('the platform destination is named {string}', async function (name) { assert.equal(name, 'Featherbase'); await this.baseInstall.platformName(); });
Then('Tasker retains its own app name', async function () { await this.baseInstall.taskerName(); });
