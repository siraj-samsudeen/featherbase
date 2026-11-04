'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { BoundedExplorePage } = require('../support/pages/bounded-explore-page');

async function arrange(world, connected) {
  world.boundedExplore = new BoundedExplorePage(await world.actor(), connected);
  await world.withApi(api => world.boundedExplore.install(api));
}

Given('synthetic sections lead through floor sections and assignment sections to assignments and workers', async function () { await arrange(this, false); });
Given('synthetic connected sections lead through floor sections and assignment sections to assignments and workers', async function () { await arrange(this, true); });
When('the user explores those five stages from sections to workers', async function () { await this.boundedExplore.open(); });
When('the user follows the five-stage connected journey beyond the displayed upstream rows', async function () { await this.boundedExplore.open(); });
When('the user narrows the five-stage journey to North and then releases North', async function () { await this.boundedExplore.narrowThenRelease(); });
Then('the final stage shows each reachable worker once', async function () { await this.boundedExplore.expectWorkers(); });
Then('no sixth stage can be added', async function () { await this.boundedExplore.expectBounded(); });
Then('the final stage again shows all reachable workers', async function () { await this.boundedExplore.expectWorkers(); });
Then('opening a worker returns to the unchanged journey', async function () { await this.boundedExplore.expectPeekPreservesJourney(); });
Then('every reachable worker is counted once', async function () { await this.boundedExplore.expectWorkers(); });
Then('an unreadable intermediate stage cannot reveal workers', async function () { await this.withApi(api => this.boundedExplore.expectUnreadable(api)); });
