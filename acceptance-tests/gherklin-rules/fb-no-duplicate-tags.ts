import type { Tag } from '@cucumber/messages'
import { defineRule } from './_rule'

export default defineRule('fb-no-duplicate-tags', (document, report) => {
  const f = document.feature
  const lists: Tag[][] = [f.tags]
  for (const c of f.children) {
    if (c.scenario) lists.push(c.scenario.tags, ...c.scenario.examples.map((e) => e.tags))
    if (c.rule) {
      lists.push(c.rule.tags)
      for (const rc of c.rule.children)
        if (rc.scenario) lists.push(rc.scenario.tags, ...rc.scenario.examples.map((e) => e.tags))
    }
  }
  for (const tags of lists) {
    const seen = new Set<string>()
    for (const t of tags) {
      if (seen.has(t.name)) report(`Duplicate tag ${t.name}.`, t.location)
      seen.add(t.name)
    }
  }
})
