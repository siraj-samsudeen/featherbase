import { z } from 'zod'

// zod's own messages reach people: field errors on forms, imports and API
// refusals. zod 4 reworded them ("Required" became "Invalid input: expected
// string, received undefined"), and the server's hand-written checks still say
// "Required", so the two would disagree. This keeps zod 3's wording for the
// issues people meet: a missing or wrong-typed value and a value outside a
// choice list. Every other issue keeps zod 4's message. Set once for the
// process; the server and the web app both load it through `shared`.

/** zod 3's name for a value's type, as its messages printed it. */
function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (value instanceof Map) return 'map'
  if (value instanceof Set) return 'set'
  if (value instanceof Promise) return 'promise'
  if (typeof value === 'number') return Number.isNaN(value) ? 'nan' : 'number'
  return typeof value
}

const quoted = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value))

z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type') {
      return issue.input === undefined ? 'Required' : `Expected ${issue.expected}, received ${typeName(issue.input)}`
    }
    if (issue.code === 'invalid_value') {
      const literal = (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def?.type === 'literal'
      if (literal) return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`
      return `Invalid enum value. Expected ${issue.values.map(quoted).join(' | ')}, received ${quoted(issue.input)}`
    }
    return undefined
  },
})
