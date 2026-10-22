// The shared UI primitives (#380 stage 1b). Pure component tests: no server,
// no database. They pin behaviour and accessibility, not pixels — the look is
// the tokens' job and design-guards.test.ts guards those.

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  Button,
  buttonClasses,
  Card,
  EmptyState,
  Field,
  inputClasses,
  Notice,
  PasswordInput,
  SearchInput,
  Select,
  Skeleton,
  StatusPill,
  TextInput,
  TOAST_MS,
  ToastProvider,
  useToast,
} from '../src/components/ui'

describe('Button', () => {
  test('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  test('the primary variant fills with the action colour', () => {
    render(<Button variant="primary">Sign in</Button>)
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toMatch(/\bbg-action\b/)
  })

  test('while loading it keeps its name, refuses clicks and says it is busy', async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: /Save/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  test('its class recipe dresses a link as a button without wrapping it', () => {
    render(<a href="/x" className={buttonClasses({ variant: 'secondary' })}>Open</a>)
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link.className).toMatch(/\bmin-h-control\b/)
    expect(link.className).toMatch(/\bborder-border-control\b/)
  })
})

describe('Field', () => {
  test('names its control with the label, and the hint describes it', () => {
    render(
      <Field label="Employee code" hint="As printed on your ID card">
        <TextInput />
      </Field>,
    )
    const input = screen.getByLabelText('Employee code')
    expect(input).toHaveAccessibleDescription('As printed on your ID card')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  test('an error marks the control invalid and is read with it', () => {
    render(
      <Field label="Password" error="That password is wrong">
        <TextInput />
      </Field>,
    )
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('That password is wrong')
  })

  test('a select is named by its label too', () => {
    render(
      <Field label="Store">
        <Select>
          <option>1501 Attakulangara</option>
        </Select>
      </Field>,
    )
    expect(screen.getByLabelText('Store').tagName).toBe('SELECT')
  })

  test('a search box is a searchbox with the given name', () => {
    render(<SearchInput aria-label="Search checklists" />)
    expect(screen.getByRole('searchbox', { name: 'Search checklists' })).toBeInTheDocument()
  })
})

describe('PasswordInput', () => {
  test('the show control reveals and hides the password, and says which it is doing', async () => {
    render(
      <Field label="Password">
        <PasswordInput defaultValue="secret" />
      </Field>,
    )
    const input = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(input).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Notice', () => {
  test('an error interrupts as an alert', () => {
    render(<Notice tone="negative">Could not save the row</Notice>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the row')
  })

  test('anything else is a polite status', () => {
    render(<Notice tone="caution">Test mode: StyleHR is not asked</Notice>)
    expect(screen.getByRole('status')).toHaveTextContent('Test mode: StyleHR is not asked')
  })
})

describe('StatusPill', () => {
  test('says its status in words, coloured by meaning', () => {
    render(<StatusPill tone="negative">Overdue</StatusPill>)
    const pill = screen.getByText('Overdue')
    expect(pill.className).toMatch(/\btext-negative\b/)
  })
})

describe('Card', () => {
  test('a titled card is a named region', () => {
    render(<Card title="Where the gap is">rows</Card>)
    expect(screen.getByRole('region', { name: 'Where the gap is' })).toHaveTextContent('rows')
  })
})

describe('EmptyState', () => {
  test('says what is empty and offers the way forward', () => {
    render(<EmptyState title="No checklists yet" body="Runs appear here." action={<Button>Start a checklist</Button>} />)
    expect(screen.getByRole('heading', { name: 'No checklists yet' })).toBeInTheDocument()
    expect(screen.getByText('Runs appear here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a checklist' })).toBeInTheDocument()
  })

  test('a title alone is not an empty state: it needs an explanation or an action', () => {
    // @ts-expect-error — no way forward
    render(<EmptyState title="Nothing here" />)
    render(<EmptyState title="Explained" body="Rows appear once someone adds one." />)
    render(<EmptyState title="Actionable" action={<Button>Add one</Button>} />)
  })
})

describe('Skeleton', () => {
  test('announces what is loading, and its placeholder bars stay silent', () => {
    const { container } = render(<Skeleton label="Loading rows" lines={3} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading rows')
    expect(container.querySelectorAll('[aria-hidden="true"] > *')).toHaveLength(3)
  })
})

describe('Toast', () => {
  afterEach(() => vi.useRealTimers())

  function Trigger({ tone, message, label = 'Go' }: { tone: 'positive' | 'negative'; message: string; label?: string }) {
    const toast = useToast()
    return <Button onClick={() => toast({ tone, message })}>{label}</Button>
  }
  const tick = (ms: number) => act(async () => vi.advanceTimersByTime(ms))

  test('one polite live region is there before any toast, and confirmations appear inside it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <ToastProvider>
        <Trigger tone="positive" message="Row saved" />
      </ToastProvider>,
    )
    const live = within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    // Not atomic: a second toast is announced alone, not the whole stack again.
    expect(live).toHaveAttribute('aria-atomic', 'false')
    expect(live).toBeEmptyDOMElement()
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(within(live).getByText('Row saved')).toBeInTheDocument()
  })

  test('a confirmation leaves on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <ToastProvider>
        <Trigger tone="positive" message="Row saved" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    await tick(TOAST_MS + 100)
    expect(screen.queryByText('Row saved')).toBeNull()
  })

  test("a second toast does not restart the first one's timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <ToastProvider>
        <Trigger tone="positive" message="First" label="One" />
        <Trigger tone="positive" message="Second" label="Two" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'One' }))
    await tick(3000)
    await userEvent.click(screen.getByRole('button', { name: 'Two' }))
    await tick(2100)
    expect(screen.queryByText('First')).toBeNull()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  test('pointing at a toast or focusing it pauses its timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <ToastProvider>
        <Trigger tone="positive" message="Row saved" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    await tick(2000)
    const card = screen.getByText('Row saved').closest('[data-toast]') as HTMLElement
    await userEvent.hover(card)
    await tick(TOAST_MS * 2)
    expect(screen.getByText('Row saved')).toBeInTheDocument()
    await userEvent.unhover(card)
    const dismiss = within(card).getByRole('button', { name: 'Dismiss' })
    await act(async () => dismiss.focus())
    await tick(TOAST_MS * 2)
    expect(screen.getByText('Row saved')).toBeInTheDocument()
    await act(async () => dismiss.blur())
    await tick(TOAST_MS - 2000 + 100)
    expect(screen.queryByText('Row saved')).toBeNull()
  })

  test('a failure is an alert and stays until the user dismisses it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <ToastProvider>
        <Trigger tone="negative" message="Could not save" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    await tick(20000)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not save')
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('focus stays visible in forced-colours mode', () => {
  test('a text box hides its outline with a transparent one, never removes it', () => {
    const c = inputClasses().split(' ')
    expect(c).toContain('focus:outline-hidden')
    expect(c).not.toContain('focus:outline-none')
  })
})
