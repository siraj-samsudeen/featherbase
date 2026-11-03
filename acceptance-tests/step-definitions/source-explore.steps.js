'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { SourceExplorePage } = require('../support/pages/source-explore-page');

async function arrange(world) {
  await world.withApi(api => SourceExplorePage.install(api));
  world.sourceExplore = new SourceExplorePage(await world.actor());
}

Given('a connected Postgres source has North with two floors, South with one floor and Empty with none', async function () { await arrange(this); });
Given('a connected Postgres source has more than five hundred stores', async function () { await arrange(this); });
When('the user explores stores followed by floors without selecting a store', async function () { await this.sourceExplore.open(); });
When('the user explores floors for North', async function () { await this.sourceExplore.open('North'); });
When('the user explores floors for Empty', async function () { await this.sourceExplore.open('Empty'); });
Then('the user sees the three linked floors with a total of three', async function () { await this.sourceExplore.expectFloors(['North one', 'North two', 'South only'], 3); });
Then("the user sees only North's two floors with a total of two", async function () { await this.sourceExplore.expectFloors(['North one', 'North two'], 2); });
Then('the user sees no floors with a total of zero', async function () { await this.sourceExplore.expectFloors([], 0); });
When('the user explores floors for stores matching {string} without selecting a store', async function (label) { await this.withApi(api => this.sourceExplore.filtered(api, label)); });
Then('the connected result has no floors with a total of zero', function () { this.sourceExplore.expectEmpty(); });
When('the user explores floors without selecting a store from that source', async function () { await this.withApi(api => this.sourceExplore.large(api)); });
Then('floors linked to stores beyond the displayed page contribute to the exact result', function () { this.sourceExplore.expectLarge(); });
