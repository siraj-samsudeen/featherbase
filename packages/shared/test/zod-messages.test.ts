// #747: zod 4 reworded the messages people see on forms, imports and API
// refusals. zod-messages.ts keeps zod 3's wording for the issues people meet;
// these pin each of them, and that every other issue keeps zod 4's own.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tableSchemaToZod } from '../src/schema'

const message = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('expected a refusal')
  return result.error.issues[0].message
}

describe('zod 3 wording, kept under zod 4', () => {
  it('a missing value is "Required"', () => {
    expect(message(z.object({ a: z.string() }), {})).toBe('Required')
  })

  it.each([
    [null, 'null'],
    [[1], 'array'],
    [new Date(0), 'date'],
    [new Map(), 'map'],
    [new Set(), 'set'],
    [Promise.resolve(), 'promise'],
    [Number.NaN, 'nan'],
    [7, 'number'],
    [true, 'boolean'],
    [{}, 'object'],
  ])('a wrong-typed value names what it got: %s is "%s"', (value, received) => {
    expect(message(z.string(), value)).toBe(`Expected string, received ${received}`)
  })

  it('a value outside a choice list names the choices and the value', () => {
    expect(message(z.enum(['open', 'closed']), 'pending')).toBe("Invalid enum value. Expected 'open' | 'closed', received 'pending'")
  })

  it('a number outside a choice of numbers is quoted as a number', () => {
    expect(message(z.enum({ one: 1, two: 2 }), 3)).toBe("Invalid enum value. Expected 1 | 2, received 3")
  })

  it('a value that is not the one literal names it', () => {
    expect(message(z.literal('addTable'), 'dropTable')).toBe('Invalid literal value, expected "addTable"')
  })

  it('every other issue keeps zod 4\'s message', () => {
    expect(message(z.string().min(3), 'ab')).toBe('Too small: expected string to have >=3 characters')
  })
})

describe('the Int column', () => {
  const int = tableSchemaToZod([{ column_name: 'n', column_type: 'Int' }]).shape.n

  it('a fraction is not a whole number', () => {
    expect(message(int, 1.5)).toBe('Expected integer, received float')
  })
})
