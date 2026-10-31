import { defineRule, isOutline, scenarios } from './_rule'

export default defineRule('fb-no-examples-in-scenarios', (document, report) => {
  for (const s of scenarios(document))
    if (!isOutline(s) && s.examples.length > 0)
      report('Cannot use "Examples" in a "Scenario", use a "Scenario Outline" instead.', s.location)
})
