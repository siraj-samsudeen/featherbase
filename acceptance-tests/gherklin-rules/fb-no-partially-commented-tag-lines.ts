import { defineRule, tagLines } from './_rule'

export default defineRule('fb-no-partially-commented-tag-lines', (document, report) => {
  for (const { text, line } of tagLines(document)) {
    const at = text.indexOf('#')
    if (at > -1) report('Partially commented tag lines are not allowed.', { line, column: at + 1 })
  }
})
