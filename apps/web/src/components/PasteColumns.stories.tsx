import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PasteColumns } from './PasteColumns'

/**
 * A way to give a new Table its columns by pasting a spreadsheet header row (and, optionally, sample rows that
 * set each type) instead of adding them one by one. Closed, it is a quiet link; open, a box with a preview of
 * each column and its guessed type. `onBuild` receives the columns. Use it in the Table builder.
 */
const meta = {
  title: 'Admin/PasteColumns',
  component: PasteColumns,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
  args: { onBuild: fn() },
} satisfies Meta<typeof PasteColumns>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('dt-paste-open'))
  },
}

export const SampleGuessesTypes: Story = {
  name: 'A sample guesses each type',
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByTestId('dt-paste-open'))
    await userEvent.click(canvas.getByTestId('dt-paste-sample'))
    await expect(canvas.getByText(/Salary\s·\s/)).toBeVisible()
    await userEvent.click(canvas.getByTestId('dt-paste-build'))
    await expect(args.onBuild).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: 'Employee Name' })]))
  },
}
