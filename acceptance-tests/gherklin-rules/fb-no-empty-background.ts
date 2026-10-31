import { backgrounds, defineRule } from './_rule'

export default defineRule('fb-no-empty-background', (document, report) => {
  for (const { background } of backgrounds(document))
    if (background.steps.length === 0) report('Empty background.', background.location)
})
