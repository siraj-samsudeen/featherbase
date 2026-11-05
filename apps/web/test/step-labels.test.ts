import { describe, expect, test } from 'vitest'
import { filterText } from '../src/lib/step-labels'

// #910 checklist 11 and 22: a filter step is named for whoever is looking,
// never by the ids it filters on.

describe('filterText', () => {
  test("while the table's columns load, a value shows as a placeholder, never as itself", () => {
    expect(filterText('Nv Site', undefined, ['region', '=', 'KL'], () => 'Kerala · KL')).toBe('region: …')
  })
})
