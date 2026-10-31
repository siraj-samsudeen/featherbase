import { defineRule } from './_rule'

export default defineRule('fb-no-unnamed-features', (document, report) => {
  if (document.gherkinDocument.feature && !document.feature.name.trim())
    report('Found a feature with no name.', document.feature.location)
})
