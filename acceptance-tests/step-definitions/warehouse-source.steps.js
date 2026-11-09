'use strict';

// The external-data-sources warehouse scenarios run as Vitest tests (#1070).
// This step is still shared by the asset scenarios, whose When step makes the
// call that must be refused.

const { Then } = require('@cucumber/cucumber');

Then('the change is refused', function () {
  // Checked by the call in the When step.
});
