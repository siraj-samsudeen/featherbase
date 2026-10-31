import { defineRule, scenarios } from './_rule'

export default defineRule('fb-no-unnamed-scenarios', (document, report) => {
  for (const s of scenarios(document)) if (!s.name.trim()) report('Found a scenario with no name.', s.location)
})
