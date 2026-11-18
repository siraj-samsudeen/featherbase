// #1282 G1–G6: the area picker (Columns) on its own, with made-up places and a
// load that answers as the viewer may see them.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AreaPicker, type AreaAxis, type AreaRow } from '@featherbase/shop-floor'

afterEach(cleanup)

const LOCATION: AreaAxis = {
  name: 'Location', whole: 'Whole company',
  levels: [
    { table: 'Cluster', label: 'Cluster', plural: 'clusters' },
    { table: 'Site', label: 'Store', plural: 'stores' },
    { table: 'Store Floor', label: 'Floor', plural: 'floors' },
  ],
}
const MERCHANDISE: AreaAxis = {
  name: 'Merchandise', whole: 'All merchandise',
  levels: [{ table: 'Division', label: 'Division', plural: 'divisions' }, { table: 'Category', label: 'Category', plural: 'categories' }],
}

const PLACES: Record<string, AreaRow[]> = {
  'Cluster:': [{ id: 'south', name: 'Chennai South', count: 2 }, { id: 'north', name: 'North', count: 1 }],
  'Site:south': [{ id: 'e', name: 'Store E', count: 2 }, { id: 'f', name: 'Store F', count: 1 }],
  'Site:north': [{ id: 'g', name: 'Store G', count: 0 }],
  'Store Floor:e': [{ id: 'e1', name: 'First floor' }, { id: 'e2', name: 'Second floor' }],
  'Division:': [{ id: 'kids', name: 'Kids', count: 1 }],
  'Category:kids': [{ id: 'ethnic', name: 'Kids Ethnic' }],
}

function open(holds = ['Site']) {
  const load = vi.fn(async (axis: AreaAxis, level: number, parent: AreaRow | null) => PLACES[`${axis.levels[level]!.table}:${parent?.id ?? ''}`] ?? [])
  const onUse = vi.fn()
  const onCancel = vi.fn()
  render(<AreaPicker axes={[LOCATION, MERCHANDISE]} holds={holds} load={load} onUse={onUse} onCancel={onCancel} />)
  return { load, onUse, onCancel }
}

const column = (label: string) => screen.getByRole('region', { name: label })
const bar = () => screen.getByTestId('area-bar')
const words = () => screen.getByTestId('area-words')

describe('the area picker', () => {
  test('with nothing picked the area is the whole company, and each row says what is under it', async () => {
    open()
    expect(words()).toHaveTextContent('Area: Whole company')
    expect(await within(column('Cluster')).findByRole('button', { name: /Chennai South\s*2 stores/ })).toBeInTheDocument()
    expect(within(column('Cluster')).getByRole('button', { name: /North\s*1 store$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use this area' })).toBeDisabled()
  })

  test('picking opens the next column; picking higher clears the columns to its right', async () => {
    open()
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /Chennai South/ }))
    fireEvent.click(await within(column('Store')).findByRole('button', { name: /Store E/ }))
    expect(await within(column('Floor')).findByRole('button', { name: 'First floor' })).toBeInTheDocument()
    fireEvent.click(within(column('Cluster')).getByRole('button', { name: /North/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Floor' })).not.toBeInTheDocument())
    expect(await within(column('Store')).findByRole('button', { name: /Store G/ })).toBeInTheDocument()
    expect(words()).toHaveTextContent('Area: North')
  })

  test('the area reads as links, part by part', async () => {
    open()
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /Chennai South/ }))
    fireEvent.click(await within(column('Store')).findByRole('button', { name: /Store E/ }))
    expect(words()).toHaveTextContent('Area: Chennai South › Store E')
    expect(within(bar()).getByRole('link', { name: 'Chennai South' })).toHaveAttribute('href', expect.stringContaining('/row/south'))
    expect(within(bar()).getByRole('link', { name: 'Store E' })).toHaveAttribute('href', expect.stringContaining('/row/e'))
  })

  test('a level the field cannot hold yet stays walkable, with Use this area off and one line saying why', async () => {
    const { onUse } = open()
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /Chennai South/ }))
    expect(screen.getByRole('button', { name: 'Use this area' })).toBeDisabled()
    expect(screen.getByTestId('area-not-yet')).toHaveTextContent('Can be given at Store level for now')
    fireEvent.click(await within(column('Store')).findByRole('button', { name: /Store E/ }))
    expect(screen.queryByTestId('area-not-yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this area' }))
    expect(onUse).toHaveBeenCalledWith({ axis: 'Location', level: 1, table: 'Site', row: expect.objectContaining({ id: 'e', name: 'Store E' }) })
  })

  test('Stop here closes the deeper columns; Cancel leaves', async () => {
    const { onCancel } = open()
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /Chennai South/ }))
    fireEvent.click(await within(column('Store')).findByRole('button', { name: /Store E/ }))
    await within(column('Floor')).findByRole('button', { name: 'First floor' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop here' }))
    expect(screen.queryByRole('region', { name: 'Floor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop here' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  test('Merchandise is the other axis, its whole being all merchandise; switching starts afresh', async () => {
    open(['Site'])
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /Chennai South/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Area by' })).getByRole('button', { name: 'Merchandise' }))
    expect(words()).toHaveTextContent('Area: All merchandise')
    fireEvent.click(await within(column('Division')).findByRole('button', { name: /Kids\s*1 category/ }))
    expect(await within(column('Category')).findByRole('button', { name: 'Kids Ethnic' })).toBeInTheDocument()
    // This field holds a store, so no merchandise level can be used yet.
    expect(screen.getByRole('button', { name: 'Use this area' })).toBeDisabled()
  })

  test('one level back, as a phone shows one column at a time; a column with nothing reads None', async () => {
    open()
    fireEvent.click(await within(column('Cluster')).findByRole('button', { name: /North/ }))
    fireEvent.click(await within(column('Store')).findByRole('button', { name: /Store G/ }))
    expect(await within(column('Floor')).findByText('None')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back one level' }))
    expect(words()).toHaveTextContent('Area: North')
  })

  test('a column whose read fails reads None, never an error', async () => {
    render(<AreaPicker axes={[LOCATION]} holds={['Site']} load={async () => { throw new Error('down') }} onUse={() => {}} onCancel={() => {}} />)
    expect(await within(column('Cluster')).findByText('None')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Area by' })).not.toBeInTheDocument()
  })
})
