// #1345: the shared Person Label (@featherbase/shop-floor) and the words it reads
// (shared/person-label.ts). People who share a name are told apart everywhere alike.
// Made-up people.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { needsEmail, personMetaShort, personMetaText, rowHref } from 'shared'
import { PersonLabel } from '@featherbase/shop-floor'

const ID = 'psn_madeupmadeupmadeupaa'

describe('PersonLabel', () => {
  test("is a link to the Person with who they are under the name; their other codes in a +1 chip, each a link where one is given", () => {
    render(<PersonLabel rowId={ID} name="Arun Prakash" label={{ code: 'TN-10002', role: 'Cashier', place: 'Hill Road',
      more_codes: [{ code: 'TN-10001', table: 'Employee', row_id: 'TN-10001' }, { code: 'TN-10000' }] }} />)
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', rowHref('Person', ID))
    expect(screen.getByTestId('person-meta')).toHaveTextContent('TN-10002 · Cashier · Hill Road')
    const chip = screen.getByTestId('person-more-codes')
    expect(chip).toHaveTextContent('+2 codes')
    const listed = within(chip).getAllByRole('listitem')
    expect(within(listed[0]!).getByRole('link')).toHaveAttribute('href', rowHref('Employee', 'TN-10001'))
    expect(within(listed[1]!).queryByRole('link')).toBeNull()
    expect(listed[1]).toHaveTextContent('TN-10000')
  })

  test('inside a row that is itself the link, it draws no link of its own and its codes are the chip\'s title', () => {
    render(<PersonLabel rowId={ID} name="Arun Prakash" inLink label={{ code: 'TN-10002', more_codes: [{ code: 'TN-10001' }] }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('+1 code')).toHaveAttribute('title', 'TN-10001')
    expect(within(screen.getByTestId('person-more-codes')).queryByRole('list')).toBeNull()
  })

  test('inline, each part is marked so a narrow cell drops the role first, then the place, never the code', () => {
    render(<PersonLabel rowId={ID} name="Arun Prakash" layout="inline" label={{ code: 'TN-10002', role: 'Cashier', place: 'Hill Road' }} />)
    const parts = [...screen.getByTestId('person-meta').querySelectorAll('[data-part]')]
    expect(parts.map((p) => [p.getAttribute('data-part'), p.className.includes('hidden')])).toEqual([['code', false], ['role', true], ['place', true]])
  })

  test('someone the viewer may not open reads as plain words', () => {
    render(<PersonLabel rowId={ID} name="Arun Prakash" canOpen={false} label={{ code: 'TN-10002' }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Arun Prakash')).toBeInTheDocument()
  })

  test('with nothing known it shows the name alone', () => {
    render(<PersonLabel rowId={ID} name="Arun Prakash" />)
    expect(screen.queryByTestId('person-meta')).toBeNull()
  })
})

describe('the words beside a name', () => {
  test('code · role · place; the email when nothing else, or where asked for', () => {
    expect(personMetaText({ code: 'TN-1', role: 'Cashier', place: 'Hill Road' })).toBe('TN-1 · Cashier · Hill Road')
    expect(personMetaText({ role: 'Area Manager', place: 'North' })).toBe('Area Manager · North')
    expect(personMetaText({ email: 'a@example.test' })).toBe('a@example.test')
    expect(personMetaText({ code: 'TN-1', email: 'a@example.test' }, { withEmail: true })).toBe('TN-1 · a@example.test')
    expect(personMetaText(undefined)).toBe('')
  })

  test('Former Staff with the day they left and the code; Consultant or Supplier with the company', () => {
    expect(personMetaText({ standing: 'left', left_on: '2026-03-12', code: '3990' })).toBe('Former Staff · left 12-Mar-2026 · 3990')
    expect(personMetaText({ standing: 'left', code: '3990' })).toBe('Former Staff · 3990')
    expect(personMetaText({ standing: 'consultant', company: 'Made-up Advisory' })).toBe('Consultant · Made-up Advisory')
    expect(personMetaText({ standing: 'supplier' })).toBe('Supplier')
  })

  test('the short form for activity lines', () => {
    expect(personMetaShort({ code: 'TN-1', role: 'Cashier', place: 'Hill Road' })).toBe('(TN-1 · Hill Road)')
    expect(personMetaShort({ email: 'a@example.test' })).toBe('')
  })

  test('only people who would read exactly the same need their email', () => {
    const a = { title: 'Ravi', person: { role: 'Cashier', email: 'a@example.test' } }
    const b = { title: 'Ravi', person: { role: 'Cashier', email: 'b@example.test' } }
    const c = { title: 'Ravi', person: { code: 'TN-3' } }
    expect([...needsEmail([a, b, c])]).toEqual([a, b])
  })
})
