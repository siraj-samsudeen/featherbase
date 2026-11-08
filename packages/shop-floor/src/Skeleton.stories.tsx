import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Skeleton } from './Skeleton'

const meta = {
  title: 'Shop floor/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The placeholder a section shows on its first load: grey bars, and a `label` that tells assistive tech what is loading. Use it ' +
          'in place of content that is coming ("Loading your numbers"), not for a refresh of content already shown. `DataList` shows one ' +
          'by itself while its `state` is `loading`.',
      },
    },
  },
  args: { label: 'Loading your numbers' },
} satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>

export const ThreeLines: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Loading your numbers')
  },
}

export const OneLine: Story = { args: { lines: 1 } }
export const ManyLines: Story = { args: { lines: 8, label: 'Loading the stock count' } }
