import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Field, PasswordInput, SearchInput, Select, TextInput } from './Field'

/**
 * A labelled form control with an optional hint and error. Wrap exactly one control: `TextInput`,
 * `PasswordInput` (with show/hide), `Select` (a real select with the design system chevron) or `SearchInput`.
 * The label names the control and the hint and error describe it, so a screen reader reads them together; an
 * error also marks the control invalid. Use `inputClasses()` / `labelClasses()` only for a control this kit has
 * no component for.
 */
const meta = {
  title: 'Shop floor/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
  args: { label: 'Employee code', children: <TextInput placeholder="RR-0107" autoCapitalize="characters" /> },
} satisfies Meta<typeof Field>
export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {}

export const WithHint: Story = {
  args: { hint: 'As printed on your ID card' },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Employee code' })
    await expect(box).toHaveAccessibleDescription('As printed on your ID card')
  },
}

export const WithError: Story = {
  args: { label: 'Quantity', error: 'Enter a number of 1 or more', children: <TextInput defaultValue="0" inputMode="numeric" /> },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Quantity' })
    await expect(box).toBeInvalid()
    await expect(box).toHaveAccessibleDescription('Enter a number of 1 or more')
  },
}

export const Disabled: Story = { args: { label: 'Store', children: <TextInput defaultValue="1501 Attakulangara" disabled /> } }

export const Password: Story = {
  args: { label: 'Password', children: <PasswordInput placeholder="StyleHR password" defaultValue="monsoon-2026" /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const show = canvas.getByRole('button', { name: 'Show password' })
    await expect(canvas.getByLabelText('Password')).toHaveAttribute('type', 'password')
    await userEvent.click(show)
    await expect(show).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByLabelText('Password')).toHaveAttribute('type', 'text')
  },
}

export const Choice: Story = {
  name: 'Select',
  args: {
    label: 'Store',
    children: (
      <Select defaultValue="1501">
        <option value="1501">1501 Attakulangara</option>
        <option value="1515">1515 Kattakada</option>
        <option value="1622">1622 Thampanoor Junction, opposite the central bus stand</option>
      </Select>
    ),
  },
}

export const Search: Story = {
  args: { label: 'Search checklists', children: <SearchInput placeholder="Search checklists" /> },
}

export const LongLabelAndHint: Story = {
  name: 'A long label and hint wrap',
  args: {
    label: 'Name of the person who received the delivery at the back gate',
    hint: 'Use the name on their StyleHR record, not a nickname, so the goods receipt can be matched to the right shift.',
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

/** The gallery's form: a two-column grid of fields. */
export const FormGrid: Story = {
  decorators: [(Story) => <div className="max-w-none"><Story /></div>],
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Employee code" hint="As printed on your ID card"><TextInput placeholder="RR-0107" /></Field>
      <Field label="Password"><PasswordInput placeholder="StyleHR password" /></Field>
      <Field label="Store">
        <Select defaultValue="1501">
          <option value="1501">1501 Attakulangara</option>
          <option value="1515">1515 Kattakada</option>
        </Select>
      </Field>
      <Field label="Quantity" error="Enter a number of 1 or more"><TextInput defaultValue="0" inputMode="numeric" /></Field>
    </div>
  ),
}
