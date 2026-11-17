// The navigation rule (#1227): every Featherbase record shown on a screen is a
// RecordLink (@featherbase/shop-floor). A link to the record, an app's own page
// when it maps one, plain text only when the viewer may not open it.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { rowHref } from 'shared'
import { RecordLink, RecordPagesProvider } from '@featherbase/shop-floor'

describe('RecordLink', () => {
  test("is a link to the record's Featherbase page, named, with who it is beside the name", () => {
    render(<RecordLink table="Employee" rowId="E1001" name="Kumar" detail="E1001 · Team Leader · Lakeside" />)
    const link = screen.getByRole('link', { name: 'Kumar · E1001 · Team Leader · Lakeside' })
    expect(link).toHaveAttribute('href', rowHref('Employee', 'E1001'))
    expect(link).toHaveAttribute('data-record-link', 'link')
  })

  test('puts the identity line under the name with two lines', () => {
    render(<RecordLink table="Employee" rowId="E1" name="Kumar" detail="E1 · Left" layout="two-lines" />)
    expect(screen.getByTestId('record-detail')).toHaveTextContent(/^E1 · Left$/)
  })

  test('is plain text, the same words, only when the viewer may not open it', () => {
    render(<RecordLink table="Employee" rowId="E1" name="Kumar" detail="E1" canOpen={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Kumar').closest('[data-record-link]')).toHaveAttribute('data-record-link', 'text')
  })

  test("opens an app's own page for its Tables, and the Featherbase record for the rest", () => {
    const pageFor = (table: string, id: string) => (table === 'dash.section' ? `/dash/?view=sections&section=${id}` : undefined)
    render(
      <RecordPagesProvider pageFor={pageFor}>
        <RecordLink table="dash.section" rowId="S7" name="Sarees" />
        <RecordLink table="Site" rowId="LKS" name="Lakeside" />
      </RecordPagesProvider>,
    )
    expect(screen.getByRole('link', { name: 'Sarees' })).toHaveAttribute('href', '/dash/?view=sections&section=S7')
    expect(screen.getByRole('link', { name: 'Lakeside' })).toHaveAttribute('href', rowHref('Site', 'LKS'))
  })

  test('opens in place on a plain click and leaves a new-tab click to the browser', () => {
    const go = vi.fn()
    render(<RecordLink table="Site" rowId="LKS" name="Lakeside" onNavigate={go} />)
    const link = screen.getByRole('link', { name: 'Lakeside' })
    expect(fireEvent.click(link)).toBe(false)
    expect(go).toHaveBeenCalledWith(rowHref('Site', 'LKS'))
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(go).toHaveBeenCalledTimes(1)
  })

  test('never shows an id as a name', () => {
    render(<RecordLink table="Person" rowId="psn_8f3a" name="  " />)
    expect(screen.getByRole('link', { name: 'Unnamed record' })).toBeInTheDocument()
    expect(screen.queryByText(/psn_8f3a/)).not.toBeInTheDocument()
  })
})
