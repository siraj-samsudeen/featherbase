import { describe, expect, test } from 'vitest'
import { changedFields, moveSelection } from '../src/lib/list-edit'

// The grid-editing seam shared by the Grid and Datasheet list views: pure
// selection movement (which also decides WHEN a row autosaves — the moment
// selection leaves it) and the changed-fields diff that becomes the PATCH
// body (per-row autosave sends only what the user actually touched).

describe('moveSelection', () => {
  test('moves within bounds and reports no row exit on a column move', () => {
    expect(moveSelection({ r: 1, c: 1 }, { dc: 1 }, 5, 4)).toEqual({
      sel: { r: 1, c: 2 },
      leftRow: false,
    })
  })

  test('moving down leaves the row', () => {
    expect(moveSelection({ r: 1, c: 2 }, { dr: 1 }, 5, 4)).toEqual({
      sel: { r: 2, c: 2 },
      leftRow: true,
    })
  })

  test('clamps at the edges — no exit when already on the last row', () => {
    expect(moveSelection({ r: 4, c: 0 }, { dr: 1 }, 5, 4)).toEqual({
      sel: { r: 4, c: 0 },
      leftRow: false,
    })
    expect(moveSelection({ r: 0, c: 0 }, { dr: -1, dc: -1 }, 5, 4)).toEqual({
      sel: { r: 0, c: 0 },
      leftRow: false,
    })
  })
})

describe('changedFields', () => {
  test('returns only edited fields, coerced per column type', () => {
    const original = { name: 'X', title: 'old', qty: 3, done: false }
    const edited = { name: 'X', title: 'new', qty: 3, done: true }
    expect(
      changedFields(original, edited, [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'qty', column_type: 'Int' },
        { column_name: 'done', column_type: 'Check' },
      ]),
    ).toEqual({ title: 'new', done: true })
  })

  test('empty string clears a field to null; untouched rows diff to nothing', () => {
    const original = { title: 'keep', note: 'text' }
    expect(
      changedFields(original, { title: 'keep', note: '' }, [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'note', column_type: 'Data' },
      ]),
    ).toEqual({ note: null })
    expect(
      changedFields(original, { ...original }, [{ column_name: 'title', column_type: 'Data' }]),
    ).toEqual({})
  })

  test('Check columns are always boolean — unchecking sends false, not null', () => {
    expect(
      changedFields({ done: true }, { done: 'false' }, [
        { column_name: 'done', column_type: 'Check' },
      ]),
    ).toEqual({ done: false })
    expect(
      changedFields({ done: false }, { done: '' }, [{ column_name: 'done', column_type: 'Check' }]),
    ).toEqual({})
  })

  test('numeric strings from inputs coerce for number columns', () => {
    expect(
      changedFields({ qty: 3 }, { qty: '4' }, [{ column_name: 'qty', column_type: 'Int' }]),
    ).toEqual({ qty: 4 })
    // Same value typed back as a string is NOT a change.
    expect(
      changedFields({ qty: 3 }, { qty: '3' }, [{ column_name: 'qty', column_type: 'Int' }]),
    ).toEqual({})
  })
})
