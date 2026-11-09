'use strict';

// "Today is 6 November 2026" for Assets' register, which reads the day in the
// browser of whoever opens it: its scenarios keep the day (10:00 in India) for
// that browser. Tasker's scenarios run as Vitest tests (#1070).

const { Before, Given } = require('@cucumber/cucumber');

Before(function ({ pickle }) { this.featureUri = pickle.uri; });

// Which app a scenario is in, by its spec's name (asset-register).
// The spec moves when its change is archived, so the name is what to go by.
Given('today is {day}', async function (day) {
  const spec = this.featureUri.match(/([^/]+)\/spec\.feature$/)?.[1] ?? this.featureUri;
  if (!/^asset-/.test(spec)) throw new Error(`"today is" doesn't know how to set the day for the spec ${spec}`);
  this.today = Date.parse(`${day}T10:00:00+05:30`);
});
