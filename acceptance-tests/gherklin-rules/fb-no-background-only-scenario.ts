import { backgrounds, defineRule } from './_rule'

export default defineRule('fb-no-background-only-scenario', (document, report) => {
  for (const { background, scenarios } of backgrounds(document))
    if (scenarios.length < 2) report('Backgrounds are not allowed when there is just one scenario.', background.location)
})
