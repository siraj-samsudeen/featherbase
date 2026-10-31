import { defineRule, isOutline, scenarios } from './_rule'

export default defineRule('fb-no-scenario-outlines-without-examples', (document, report) => {
  for (const s of scenarios(document))
    if (isOutline(s) && !s.examples.some((e) => e.tableBody.length > 0))
      report('Scenario Outline does not have any Examples.', s.location)
})
