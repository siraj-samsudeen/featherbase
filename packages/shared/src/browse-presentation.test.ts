import { describe, expect, it } from 'vitest'
import { browsePresentationSchema } from './schema'

describe('browse presentation', () => {
  it('accepts an initial filter and a direct related connection', () => {
    const presentation = { default_filters: [['enabled', '=', true]], preferred_related: { table: 'Branch', column: 'location' } }
    expect(browsePresentationSchema.parse(presentation)).toEqual(presentation)
  })
  it('rejects malformed filters, unsupported operators and unrecognized configuration', () => {
    for (const presentation of [
      { default_filters: [['enabled', '=', true, 'extra']] },
      { default_filters: [['enabled', 'execute', 'arbitrary']] },
      { preferred_related: { table: 'Branch' } },
      { html: '<script>arbitrary</script>' },
    ]) expect(browsePresentationSchema.safeParse(presentation).success).toBe(false)
  })
})
