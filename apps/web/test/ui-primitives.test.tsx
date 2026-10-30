// The shared UI primitives (#380 stage 1b). Pure component tests: no server,
// no database. They pin behaviour and accessibility, not pixels — the look is
// the tokens' job and design-guards.test.ts guards those.

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  Button,
  buttonClasses,
  iconButtonClasses,
  touchTargetClasses,
  Card,
  cardClasses,
  EmptyState,
  Field,
  inputClasses,
  Notice,
  PasswordInput,
  pillClasses,
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

  test("a select keeps the real control, hides the browser's arrow and draws a chevron", () => {
    render(
      <Field label="Store">
        <Select wrapperClassName="w-52">
          <option>1501 Attakulangara</option>
        </Select>
      </Field>,
    )
    const select = screen.getByRole('combobox', { name: 'Store' })
    expect(select.className).toMatch(/\bappearance-none\b/)
    const chevron = screen.getByTestId('select-chevron')
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(select.parentElement).toContainElement(chevron)
    expect(select.parentElement?.className).toMatch(/\bw-52\b/)
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

  test('a consumer without its provider reports the missing ToastProvider', () => {
    expect(() => render(<Trigger tone="positive" message="Saved" />)).toThrow(
      'useToast needs a <ToastProvider> above it',
    )
  })

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

describe('icon-only controls are thumb-sized', () => {
  test('a standalone icon button is a square of the control size', () => {
    const c = iconButtonClasses('hover:text-negative').split(' ')
    expect(c).toEqual(expect.arrayContaining(['size-control', 'inline-flex', 'items-center', 'justify-center', 'hover:text-negative']))
  })

  test('a glyph inside a chip gets an invisible larger hit area without growing the chip', () => {
    const c = touchTargetClasses().split(' ')
    expect(c).toContain('relative')
    expect(c).toContain('before:absolute')
    // A fixed 32px area centred on the glyph: big enough for a thumb, small enough not to reach a
    // neighbouring chip (chips sit at least 8px apart), never grown from the glyph's line box.
    expect(c).toEqual(expect.arrayContaining(['before:size-8', 'before:left-1/2', 'before:top-1/2', 'before:-translate-x-1/2', 'before:-translate-y-1/2']))
    expect(c).not.toContain('before:size-control')
  })
})

describe('density', () => {
  test('a button takes its side padding from the density token, so laptop toolbars stay as compact as before', () => {
    const c = buttonClasses().split(' ')
    expect(c).toContain('px-control-x')
    expect(c).not.toContain('px-4')
  })
})

describe('class recipes give way to the call site', () => {
  test("a call site's padding, radius and weight replace the recipe's own, never both", () => {
    const c = buttonClasses({ className: 'px-2 rounded-r-none font-medium' }).split(' ')
    expect(c).toContain('px-2')
    expect(c).not.toContain('px-control-x')
    expect(c).toContain('rounded-r-none')
    expect(c).toContain('font-medium')
    expect(c).not.toContain('font-semibold')
  })

  test('a smaller text size or height from the call site applies under a mouse only, so touch keeps 16px and 48px', () => {
    // Below 16px an iPhone zooms the page when a box is tapped (usable-on-any-device).
    const input = inputClasses('w-auto py-1 text-sm min-h-0').split(' ')
    expect(input).toEqual(expect.arrayContaining(['text-control', 'min-h-control', 'pointer-fine:text-sm', 'pointer-fine:min-h-0', 'w-auto', 'py-1']))
    expect(input).not.toContain('text-sm')
    expect(input).not.toContain('min-h-0')
    expect(input).not.toContain('w-full')
    const button = buttonClasses({ className: 'text-xs' }).split(' ')
    expect(button).toEqual(expect.arrayContaining(['text-control', 'pointer-fine:text-xs']))
    expect(button).not.toContain('text-xs')
  })

  test("a call site's colour replaces the recipe's, so two colours never compete in CSS order", () => {
    const c = iconButtonClasses('text-ink-subtle hover:text-negative').split(' ')
    expect(c).toContain('text-ink-subtle')
    expect(c).not.toContain('text-ink-muted')
    expect(c).toContain('hover:text-negative') // variants never merge; the call site's comes later in the list
    expect(inputClasses('border-negative bg-subtle').split(' ')).toEqual(expect.arrayContaining(['border-negative', 'bg-subtle']))
    expect(inputClasses('border-negative bg-subtle').split(' ')).not.toEqual(expect.arrayContaining(['border-border-control']))
  })

  test('gap-x and gap-y sit beside a recipe gap: Tailwind emits gap before its axis forms, so the axis wins', () => {
    const c = buttonClasses({ className: 'gap-x-4' }).split(' ')
    expect(c).toEqual(expect.arrayContaining(['gap-2', 'gap-x-4']))
  })

  test('a card keeps its surface and takes the caller padding', () => {
    expect(cardClasses('p-4').split(' ')).toEqual(expect.arrayContaining(['p-4', 'rounded-card', 'bg-surface']))
  })

  test('a pill is only a shape; the caller brings the colour', () => {
    expect(pillClasses('bg-positive-tint text-positive').split(' ')).toEqual(expect.arrayContaining(['rounded-full', 'text-xs', 'text-positive']))
  })
})
