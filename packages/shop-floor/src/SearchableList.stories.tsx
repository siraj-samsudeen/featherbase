import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { EmptyState } from './EmptyState'
import { SearchableList } from './SearchableList'

const STORES = [
  '1501 Attakulangara', '1515 Kattakada', '1622 Thampanoor', '1704 Kazhakkoottam', '1810 Nedumangad',
  '2101 Ernakulam MG Road', '2140 Aluva', '2302 Thrissur Round', '2410 Palakkad', '3105 Kozhikode Mavoor Road',
]

function Stores({ items = STORES, initial = '' }: { items?: string[]; initial?: string }) {
  const [query, setQuery] = useState(initial)
  return (
    <SearchableList label="Search stores" items={items} query={query} onQueryChange={setQuery} getSearchText={(s) => s}>
      {(matching) => matching.length
        ? <ul className="space-y-2 text-sm text-ink">{matching.map((s) => <li key={s}>{s}</li>)}</ul>
        : <EmptyState title="No matching stores" body="Clear the search to see every store." />}
    </SearchableList>
  )
}

const meta = {
  title: 'Shop floor/SearchableList',
  component: SearchableList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A search box over a list the screen already holds in full, with "n of m" and Clear search; the children render the matching ' +
          'items. Use it for short, fully loaded lists (examples, settings, a few dozen stores). A paginated Table must search on the ' +
          'server instead (the Admin list view does).',
      },
    },
  },
  render: () => <Stores />,
} satisfies Meta<typeof SearchableList>
export default meta
// The list is generic over its items; each story renders its own.
type Story = StoryObj

export const AllShown: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('10 of 10')
  },
}

export const Filtering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search stores' }), 'road')
    await expect(canvas.getByRole('status')).toHaveTextContent('2 of 10')
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('10 of 10')
  },
}

export const NoMatches: Story = { render: () => <Stores initial="Chennai" /> }
export const EmptyList: Story = { render: () => <Stores items={[]} /> }
