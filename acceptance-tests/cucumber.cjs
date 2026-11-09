const { extractAll } = require('./extract-gherkin.cjs');
const { effectivePaths } = require('./openspec-effective-paths.cjs');

extractAll();

// #1070: a capability whose scenarios Vitest runs (scenario(...) tests,
// tools/scenarios/) is left out here, so no scenario runs twice.
const { migratedCapabilities } = require('../tools/scenarios/bindings.cjs');
const migrated = migratedCapabilities();
const capabilityOf = (feature) => {
  const parts = feature.split('/');
  return parts[parts.lastIndexOf('specs') + 1];
};
const notMigrated = (paths) => paths.filter((p) => !migrated.has(capabilityOf(p)));

const common = {
  // tools/ci-shards.mjs names this runner's share; a person runs them all.
  paths: process.env.ACCEPTANCE_PATHS ? JSON.parse(process.env.ACCEPTANCE_PATHS) : notMigrated(effectivePaths()),
  import: ['support/**/*.js', 'step-definitions/**/*.js'],
  format: ['progress-bar', ['html', 'reports/cucumber-report.html']],
};

const specs = {
  ...common,
  paths: notMigrated(require('glob').globSync('.extracted/specs/**/*.feature', { cwd: __dirname })),
};

module.exports = { default: common, specs };
