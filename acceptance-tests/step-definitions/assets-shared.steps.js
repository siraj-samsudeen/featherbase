'use strict';

// Sentences more than one Assets spec uses. Each Assets steps file gets its flow from
// `assets(world)`; the specs' own sentences live in assets-<capability>.steps.js.

const { Then } = require('@cucumber/cucumber');
const { Assets } = require('../support/pages/assets');

const assets = world => (world.assets ??= new Assets(world));

Then('it is refused', function () {
  assets(this).refused();
});

module.exports = { assets };
