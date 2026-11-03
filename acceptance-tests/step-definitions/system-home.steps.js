'use strict';

const { Given, When, Then, After } = require('@cucumber/cucumber');
const { SystemHomePage } = require('../support/pages/system-home-page');

Given('the user can manage the platform', async function () {
  this.systemHome = new SystemHomePage(await this.asSystemManager());
  await this.systemHome.rememberCatalogue();
});

Given('a new system Table has no navigation entry', async function () {
  await this.systemHome.createUnplacedTable();
});

When('the user opens System', async function () { await this.systemHome.open(); });
Then('the existing system groups retain their order', async function () { await this.systemHome.expectStoredGroups(); });
Then('unplaced system Tables appear under Platform in name order', async function () { await this.systemHome.expectUnplacedTables(); });
Then('System contains every standalone system Table exactly once', async function () { await this.systemHome.expectCompleteCatalogue(); });
Then('the new system Table appears under Platform', async function () { await this.systemHome.expectNewTable(); });

After(async function () { await this.systemHome?.cleanup(); });
