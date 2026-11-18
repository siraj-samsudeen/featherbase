// #1282 H1–H4: a permission or a report grant as one line: records as links, the reach a muted chip.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Sentence, sentenceText, type SentencePart } from '@featherbase/shop-floor'

afterEach(cleanup)

const PERMISSION: SentencePart[] = [
  { record: { table: 'dash.business_role', row: 'r1', name: 'Store Managers' } }, ' can Edit Sections ', { chip: 'in their area' },
]
const GRANT: SentencePart[] = [
  { record: { table: 'dash.report', row: 'vs', name: 'Vendor Sales' } }, ' is given to ',
  { record: { table: 'dash.business_role', row: 'r1', name: 'Store Managers' } }, ' and ',
  { record: { table: 'dash.business_role', row: 'r2', name: 'Cluster Managers' } }, ' ', { chip: 'each in their own area' },
]

describe('a sentence', () => {
  test('names its records as links and says its reach once, as a chip', () => {
    render(<Sentence parts={PERMISSION} />)
    const line = screen.getByTestId('sentence')
    expect(line).toHaveTextContent('Store Managers can Edit Sections in their area')
    expect(within(line).getByRole('link', { name: 'Store Managers' })).toHaveAttribute('href', expect.stringContaining('/row/r1'))
    expect(within(line).getAllByTestId('sentence-reach').map((c) => c.textContent)).toEqual(['in their area'])
  })

  test('a record the viewer may not open is its name in plain words', () => {
    render(<Sentence parts={[{ record: { table: 'dash.report', row: 'x', name: 'Store P&L', canOpen: false } }, ' is given to no one']} />)
    expect(within(screen.getByTestId('sentence')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByTestId('sentence')).toHaveTextContent('Store P&L is given to no one')
  })

  test('its plain words, for a tooltip, read the same line', () => {
    expect(sentenceText(PERMISSION)).toBe('Store Managers can Edit Sections in their area')
    expect(sentenceText(GRANT)).toBe('Vendor Sales is given to Store Managers and Cluster Managers each in their own area')
  })
})
