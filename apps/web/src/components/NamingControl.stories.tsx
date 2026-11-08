import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { NamingControl } from './NamingControl'

const COLUMNS = [
  { column_name: 'store_code', label: 'Store code' },
  { column_name: 'store_name', label: 'Store name' },
  { column_name: 'gst_number', label: 'GST number' },
]

/** The control with its own pattern, as the Table builder holds it. */
function Naming({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return <NamingControl value={value} onChange={setValue} columns={COLUMNS} defaultPrefix="STORE-" />
}

/**
 * Edits a Table's id pattern, the rule that names its new rows: numbers 1, 2, 3; a series with a prefix
 * (STORE-001); a random id; set by the user; or taken from a column, optionally after fixed text
 * (PLANT-{plant_code}). One select holds the kinds and the columns; a line under it shows what the ids will look
 * like. Use it wherever a Table is created or renamed.
 */
const meta = {
  title: 'Admin/NamingControl',
  component: NamingControl,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 'integer', onChange: () => {}, columns: COLUMNS, defaultPrefix: 'STORE-' },
  render: (args) => <Naming initial={args.value} />,
} satisfies Meta<typeof NamingControl>
export default meta
type Story = StoryObj<typeof meta>

export const Numbers: Story = {}

export const Series: Story = {
  args: { value: 'STORE-.###' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('dt-naming-preview')).toHaveTextContent('First rows: STORE-001, STORE-002, STORE-003')
  },
}

export const RandomId: Story = { args: { value: 'hash' } }
export const SetByUser: Story = { args: { value: 'prompt' } }

export const FromAColumn: Story = {
  name: 'From a column, with a prefix',
  args: { value: 'STORE-.###' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(canvas.getByTestId('dt-naming'), 'field:store_code')
    await userEvent.type(canvas.getByTestId('dt-naming-prefix'), 'KL-')
    await expect(canvas.getByTestId('dt-naming-preview')).toHaveTextContent('Ids look like KL-‹Store code›')
  },
}

export const SeriesWithoutPrefix: Story = { name: 'A series with its prefix cleared', args: { value: '.###' } }
