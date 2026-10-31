// Shared shape for the local gherklin rules in this folder. Each `fb-` rule
// ports the gherkin-lint rule of the same name that gherklin 1.1.0 lacks, or
// has only for top-level scenarios: our specs keep every scenario inside a
// `Rule:`, which gherklin's own rules do not walk.
import { Schema, Schemas, type Document, type RawSchema } from 'gherklin'
import type { Background, Location, Scenario } from '@cucumber/messages'

type Report = (message: string, location: Location) => void

export function defineRule(name: string, check: (document: Document, report: Report) => void) {
  return class {
    public readonly name = name
    public readonly acceptedSchema = Schemas.switchOrSeveritySchema
    public readonly schema: Schema
    public constructor(raw: RawSchema) {
      this.schema = new Schema(raw)
    }
    public async run(document: Document): Promise<void> {
      check(document, (message, location) => document.addError(this as never, message, location))
    }
  }
}

/** Every scenario in the file, at the top level and inside each `Rule:`. */
export function scenarios(document: Document): Scenario[] {
  return document.feature.children.flatMap((child) =>
    child.scenario ? [child.scenario] : (child.rule?.children ?? []).flatMap((c) => (c.scenario ? [c.scenario] : [])),
  )
}

/** Each background with the scenarios it runs before (its feature's or its rule's). */
export function backgrounds(document: Document): { background: Background; scenarios: Scenario[] }[] {
  const groups = [document.feature.children, ...document.feature.children.flatMap((c) => (c.rule ? [c.rule.children] : []))]
  return groups.flatMap((children) => {
    const background = children.find((c) => c.background)?.background
    if (!background) return []
    const own = children.flatMap((c) => (c.scenario ? [c.scenario] : []))
    // A feature background also runs before every scenario inside its rules.
    return [{ background, scenarios: children === document.feature.children ? scenarios(document) : own }]
  })
}

export const isOutline = (s: Scenario) => /outline|template/i.test(s.keyword)

/** Tag lines (first non-blank character `@`) with their 1-based line numbers. */
export function tagLines(document: Document): { text: string; line: number }[] {
  return document.lines.flatMap((l, i) => (l.text.trimStart().startsWith('@') ? [{ text: l.text, line: i + 1 }] : []))
}
