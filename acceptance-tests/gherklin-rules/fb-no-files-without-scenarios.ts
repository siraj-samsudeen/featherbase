import { defineRule, scenarios } from './_rule'

export default defineRule('fb-no-files-without-scenarios', (document, report) => {
  if (document.gherkinDocument.feature && scenarios(document).length === 0)
    report('Feature file does not have any scenarios.', document.feature.location)
})
