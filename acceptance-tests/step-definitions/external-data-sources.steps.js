'use strict';

// "The user" is the seeded System Manager. The external-data-sources
// scenarios that once lived here run as Vitest tests (#1070); this step is
// still shared by other capabilities' scenarios.

const { Given } = require('@cucumber/cucumber');

Given('the user is a System Manager', async function () {
  await this.asSystemManager();
});
