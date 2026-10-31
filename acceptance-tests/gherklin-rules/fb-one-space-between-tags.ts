import { defineRule, tagLines } from './_rule'

export default defineRule('fb-one-space-between-tags', (document, report) => {
  for (const { text, line } of tagLines(document)) {
    const gap = /(@\S+)(\s{2,})(?=@)/.exec(text.split('#')[0])
    if (gap) report('There is more than one space between the tags.', { line, column: gap.index + gap[1].length + 1 })
  }
})
