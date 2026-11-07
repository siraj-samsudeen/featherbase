const { extractAll } = require('./extract-gherkin.cjs');
const { effectivePaths } = require('./openspec-effective-paths.cjs');

extractAll();

const common = {
  // tools/ci-shards.mjs names this runner's share; a person runs them all.
  paths: process.env.ACCEPTANCE_PATHS ? JSON.parse(process.env.ACCEPTANCE_PATHS) : effectivePaths(),
  import: ['support/**/*.js', 'step-definitions/**/*.js'],
  format: ['progress-bar', ['html', 'reports/cucumber-report.html']],
};

const specs = {
  ...common,
  paths: ['.extracted/specs/**/*.feature'],
};

module.exports = { default: common, specs };
