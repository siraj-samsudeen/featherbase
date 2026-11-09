// The presentational pieces relational navigation composes (#910, D6): plain
// props and callbacks, no Table metadata, no server.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Gallery } from '../src/gallery/Gallery'
import { ChipsDemo, DrillPaneDemo, PathBarDemo, TreeDemo } from '../src/gallery/RelationalExamples'
import { DrillPane, FieldGrid, GroupChip, LinkChip, PanePlace, PaneSection, PathBar, RecentPaths, resolvePanePlace, SplitWithPane, TreeOutline, ViewToggle, type TreeNode } from '@featherbase/shop-floor'

describe('ViewToggle', () => {
  test('marks the chosen view as pressed and reports a change', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ViewToggle value="table" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onChange).toHaveBeenCalledWith('compact')
  })
})

describe('PanePlace', () => {
  test('auto names the place it resolved to', () => {
    render(<PanePlace value="auto" resolved="bottom" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Auto (bottom)' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('choosing a place reports it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PanePlace value="auto" resolved="right" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Bottom' }))
    expect(onChange).toHaveBeenCalledWith('bottom')
  })

  test.each([
    [1199, 'bottom'],
    [1200, 'right'],
  ] as const)('auto at %ipx places the pane at the %s', (width, place) => {
    expect(resolvePanePlace('auto', width)).toBe(place)
  })

  test('a chosen place ignores the width', () => {
    expect(resolvePanePlace('bottom', 1600)).toBe('bottom')
  })
})

describe('LinkChip', () => {
  test('reads name first, then the code', () => {
    render(<LinkChip label="North bay" code="B-104" onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'North bay · B-104' })).toBeInTheDocument()
  })

  test('opening the label reports it', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<LinkChip label="North bay" onOpen={onOpen} />)
    await user.click(screen.getByRole('button', { name: 'North bay' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  test('go there and filter are their own actions', async () => {
    const onGoThere = vi.fn()
    const onFilter = vi.fn()
    const user = userEvent.setup()
    render(<LinkChip label="North bay" onGoThere={onGoThere} onFilter={onFilter} />)
    await user.click(screen.getByRole('button', { name: 'Go there' }))
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect([onGoThere.mock.calls.length, onFilter.mock.calls.length]).toEqual([1, 1])
  })

  test('a disabled filter says why', () => {
    render(<LinkChip label="North bay" onFilter={() => {}} filterDisabledReason="This list has no Bay column" />)
    const filter = screen.getByRole('button', { name: 'Filter' })
    expect(filter).toBeDisabled()
    expect(filter).toHaveAccessibleDescription('This list has no Bay column')
  })

  test('a row the viewer cannot read shows neither its name nor its code nor any action', () => {
    render(<LinkChip label="Secret bay" code="B-999" unreadable onOpen={() => {}} onGoThere={() => {}} onFilter={() => {}} />)
    expect(screen.getByText('Not visible to you')).toBeInTheDocument()
    expect(screen.queryByText(/Secret bay|B-999/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('GroupChip', () => {
  test('shows its label and Indian-grouped count, pressed when selected', () => {
    render(<GroupChip label="Shelf" count={125000} selected onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Shelf 1,25,000' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('selecting reports it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<GroupChip label="Shelf" count={3} onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Shelf 3' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('FieldGrid', () => {
  const groups = [
    { title: 'Location', fields: [
      { label: 'Aisle', value: '4' },
      { label: 'Temperature zone', value: '', empty: true },
    ] },
    { title: 'Notes', fields: [
      { label: 'Handling', value: 'Keep upright. '.repeat(40), long: true },
      { label: 'Hazard class', value: '', empty: true },
    ] },
  ]

  test('labels each value inside its section', () => {
    render(<FieldGrid groups={groups} />)
    expect(screen.getByRole('heading', { name: 'Location' })).toBeInTheDocument()
    expect(screen.getByText('Aisle').nextElementSibling).toHaveTextContent('4')
  })

  test('collapses every empty field under one closed disclosure', async () => {
    const user = userEvent.setup()
    render(<FieldGrid groups={groups} />)
    expect(screen.queryByText('Temperature zone')).not.toBeVisible()
    await user.click(screen.getByText('2 empty fields'))
    expect(screen.getByText('Temperature zone')).toBeVisible()
    expect(screen.getByText('Hazard class')).toBeVisible()
  })

  test('a long value clamps until Show more', async () => {
    const user = userEvent.setup()
    render(<FieldGrid groups={groups} />)
    const value = screen.getByText(/Keep upright/)
    expect(value.className).toMatch(/line-clamp-3/)
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(value.className).not.toMatch(/line-clamp-3/)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })
  test('a long value that fits its three lines offers no Show more', () => {
    const sizes = ['clientHeight', 'scrollHeight'].map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)!] as const)
    // Laid out: the value takes 60px and needs no more.
    for (const [name] of sizes) Object.defineProperty(Element.prototype, name, { configurable: true, get: () => 60 })
    try {
      render(<FieldGrid groups={groups} />)
      expect(screen.getByText(/Keep upright/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    } finally {
      for (const [name, descriptor] of sizes) Object.defineProperty(Element.prototype, name, descriptor)
    }
  })
})

describe('DrillPane', () => {
  function pane(onClose = vi.fn()) {
    render(<DrillPane kind="Bin" title="North bay · B-104" place="right" onClose={onClose}
      actions={<button type="button">Open row page</button>}>
      <PaneSection title="Points at"><p>Aisle 4</p></PaneSection>
    </DrillPane>)
    return onClose
  }

  test('is a complementary region named by its title, its kind above', () => {
    pane()
    const region = screen.getByRole('complementary', { name: 'North bay · B-104' })
    expect(region).toHaveTextContent(/^Bin\s*North bay · B-104/)
  })

  test('holds its sections under their headings', () => {
    pane()
    expect(screen.getByRole('heading', { name: 'Points at' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open row page' })).toBeInTheDocument()
  })

  test('the close button closes it', async () => {
    const user = userEvent.setup()
    const onClose = pane()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  test("its actions sit on a line of their own under the title, so they never squeeze it", () => {
    pane()
    const heading = screen.getByRole('heading', { level: 2, name: 'North bay · B-104' })
    const titleRow = screen.getByRole('button', { name: 'Close' }).parentElement!
    expect(titleRow).toContainElement(heading)
    expect(titleRow).not.toContainElement(screen.getByRole('button', { name: 'Open row page' }))
  })

  test('its title wraps between words, never inside one', () => {
    pane()
    expect(screen.getByRole('heading', { level: 2, name: 'North bay · B-104' }).className).not.toMatch(/\b(wrap-anywhere|break-all)\b/)
  })

  test('takes focus when it opens, so Escape closes it at once', () => {
    pane()
    expect(screen.getByRole('complementary', { name: 'North bay · B-104' })).toHaveFocus()
  })

  test('a key other than Escape inside the pane leaves it open', async () => {
    const user = userEvent.setup()
    const onClose = pane()
    await user.click(screen.getByText('Aisle 4'))
    await user.keyboard('{Enter}')
    expect(onClose).not.toHaveBeenCalled()
  })

  test('Escape inside the pane closes it', async () => {
    const user = userEvent.setup()
    const onClose = pane()
    await user.click(screen.getByText('Aisle 4'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('SplitWithPane', () => {
  test.each([
    ['right', 'flex-row'],
    ['bottom', 'flex-col'],
  ] as const)('places the pane %s of the content', (place, direction) => {
    render(<SplitWithPane place={place} pane={<p>Pane</p>}><p>List</p></SplitWithPane>)
    const split = screen.getByTestId('split-with-pane')
    expect(split.className).toMatch(new RegExp(`\\b${direction}\\b`))
    expect(split).toHaveTextContent(/^List\s*Pane$/)
  })

  test('without a pane, the content takes the whole width', () => {
    render(<SplitWithPane place="right" pane={null}><p>List</p></SplitWithPane>)
    expect(screen.queryByTestId('split-pane')).not.toBeInTheDocument()
  })

  test('a pane on the right stays in sight while the page scrolls', () => {
    render(<SplitWithPane place="right" pane={<p>Pane</p>}><p>List</p></SplitWithPane>)
    expect(screen.getByTestId('split-pane').className).toMatch(/\bsticky\b/)
  })

  test('a pane at the bottom opens below the content, not over it', () => {
    render(<SplitWithPane place="bottom" pane={<p>Pane</p>}><p>List</p></SplitWithPane>)
    expect(screen.getByTestId('split-pane').className).not.toMatch(/\bsticky\b/)
  })

  test('a pane at the bottom docks to the foot of its scrolling frame, under what sits above it, the content scrolling above the pane', () => {
    const proto = Element.prototype as unknown as Record<'getBoundingClientRect', (this: Element) => unknown>
    const rect = proto.getBoundingClientRect
    // The frame shows 0–800; the split starts at 120, under a path bar.
    proto.getBoundingClientRect = function (this: Element) {
      if ((this as HTMLElement).dataset?.testid === 'frame') return { top: 0, bottom: 800, height: 800 } as DOMRect
      if ((this as HTMLElement).dataset?.testid === 'split-with-pane') return { top: 120, bottom: 920, height: 800 } as DOMRect
      return { top: 0, bottom: 0, height: 0 } as DOMRect
    }
    const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'frame' ? 800 : 0 } })
    try {
      render(<div data-testid="frame" style={{ overflowY: 'auto' }}><SplitWithPane place="bottom" pane={<p>Pane</p>}><p>List</p></SplitWithPane></div>)
      expect(screen.getByTestId('split-with-pane').style.height).toBe('680px')
      expect(screen.getByText('List').parentElement!.className).toMatch(/\boverflow-auto\b/)
    } finally {
      proto.getBoundingClientRect = rect
      Object.defineProperty(Element.prototype, 'clientHeight', client)
    }
  })

  test('opening a pane at the bottom brings it into view', () => {
    const scrolled = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrolled
    try {
      const { rerender } = render(<SplitWithPane place="bottom" pane={null}><p>List</p></SplitWithPane>)
      expect(scrolled).not.toHaveBeenCalled()
      rerender(<SplitWithPane place="bottom" pane={<p>Pane</p>}><p>List</p></SplitWithPane>)
      expect(scrolled).toHaveBeenCalledOnce()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  test('the content keeps its selected line in sight when a pane docks below it', () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
    try {
      const list = <table><tbody><tr><td>Other</td></tr><tr aria-selected="true"><td>Chosen</td></tr></tbody></table>
      const { rerender } = render(<SplitWithPane place="bottom" pane={null}>{list}</SplitWithPane>)
      rerender(<SplitWithPane place="bottom" pane={<p>Pane</p>}>{list}</SplitWithPane>)
      expect(scrolled).toContain(screen.getByText('Chosen').closest('tr'))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  test('closing the pane gives focus back to the control it was opened from', () => {
    const content = <button type="button">North bay</button>
    const drill = <DrillPane kind="Bin" title="North bay" place="right" onClose={() => {}}><p>Fields</p></DrillPane>
    const { rerender } = render(<SplitWithPane place="right" pane={null}>{content}</SplitWithPane>)
    screen.getByRole('button', { name: 'North bay' }).focus()
    rerender(<SplitWithPane place="right" pane={drill}>{content}</SplitWithPane>)
    expect(screen.getByRole('complementary')).toHaveFocus()
    rerender(<SplitWithPane place="right" pane={null}>{content}</SplitWithPane>)
    expect(screen.getByRole('button', { name: 'North bay' })).toHaveFocus()
  })

  test('closing the pane finds the same control again when the page was drawn anew meanwhile', () => {
    const content = <div><button type="button">Aisle 4</button><button type="button">North bay</button></div>
    const drill = <DrillPane kind="Bin" title="North bay" place="right" onClose={() => {}}><p>Fields</p></DrillPane>
    const { rerender } = render(<SplitWithPane key="a" place="right" pane={null}>{content}</SplitWithPane>)
    screen.getByRole('button', { name: 'North bay' }).focus()
    rerender(<SplitWithPane key="a" place="right" pane={drill}>{content}</SplitWithPane>)
    // The page is drawn anew (its address changed), pane still open.
    rerender(<SplitWithPane key="b" place="right" pane={drill}>{content}</SplitWithPane>)
    rerender(<SplitWithPane key="b" place="right" pane={null}>{content}</SplitWithPane>)
    expect(screen.getByRole('button', { name: 'North bay' })).toHaveFocus()
  })

  test('closing the pane leaves focus where the person has since moved it', () => {
    const content = <div><button type="button">Aisle 4</button><button type="button">North bay</button></div>
    const drill = <DrillPane kind="Bin" title="North bay" place="right" onClose={() => {}}><p>Fields</p></DrillPane>
    const { rerender } = render(<SplitWithPane place="right" pane={null}>{content}</SplitWithPane>)
    screen.getByRole('button', { name: 'North bay' }).focus()
    rerender(<SplitWithPane place="right" pane={drill}>{content}</SplitWithPane>)
    screen.getByRole('button', { name: 'Aisle 4' }).focus()
    rerender(<SplitWithPane place="right" pane={null}>{content}</SplitWithPane>)
    expect(screen.getByRole('button', { name: 'Aisle 4' })).toHaveFocus()
  })

  test('says where its pane is, so the page around it can make room', () => {
    render(<SplitWithPane place="right" pane={<p>Pane</p>}><p>List</p></SplitWithPane>)
    expect(screen.getByTestId('split-with-pane')).toHaveAttribute('data-pane', 'right')
  })
})

describe('PathBar', () => {
  const steps = [
    { key: 'list', kindLabel: 'List', label: 'Bins' },
    { key: 'filter', kindLabel: 'Filter', label: 'Aisle: 4' },
    { key: 'row', label: 'North bay · B-104' },
  ]
  function bar(current: number, handlers: Partial<Record<'onStep' | 'onBack' | 'onForward' | 'onCopyLink', () => void>> = {}) {
    render(<PathBar steps={steps} current={current} onStep={handlers.onStep ?? vi.fn()} onBack={handlers.onBack ?? vi.fn()}
      onForward={handlers.onForward ?? vi.fn()} onCopyLink={handlers.onCopyLink ?? vi.fn()} recent={<span>Recent slot</span>} />)
  }

  test('marks the current step', () => {
    bar(1)
    const path = screen.getByRole('navigation', { name: 'Path' })
    expect(path.querySelector('[aria-current="step"]')).toHaveTextContent('Filter Aisle: 4')
  })

  test('Back is disabled at the first step', () => {
    bar(0)
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeEnabled()
  })

  test('Forward is disabled at the last step', () => {
    bar(2)
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  test('clicking an earlier step reports its index', async () => {
    const onStep = vi.fn()
    const user = userEvent.setup()
    bar(2, { onStep })
    await user.click(screen.getByRole('button', { name: 'List Bins' }))
    expect(onStep).toHaveBeenCalledWith(0)
  })

  test('Copy link reports it and says Copied in place', async () => {
    const onCopyLink = vi.fn()
    const user = userEvent.setup()
    bar(2, { onCopyLink })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })

  describe('a path longer than its bar', () => {
    const proto = Element.prototype as unknown as Record<'getBoundingClientRect', (this: Element) => unknown>
    const rect = proto.getBoundingClientRect
    // The bar has 300px for the path; "…" takes 30; each step its own width;
    // a word of text 10px a character.
    let widths: number[] = [120, 210, 120]
    beforeEach(() => {
      widths = [120, 210, 120]
      proto.getBoundingClientRect = function (this: Element) {
        const el = this as HTMLElement
        const width = el.dataset?.pathRoom !== undefined ? 300
          : el.dataset?.measureStep !== undefined ? widths[Number(el.dataset.measureStep)]
          : el.dataset?.measureMore !== undefined ? 30
          : el.dataset?.measureText !== undefined ? (el.textContent ?? '').length * 10
          : 0
        return { left: 0, right: width, width, top: 0, bottom: 0, height: 0 } as DOMRect
      }
    })
    afterEach(() => { proto.getBoundingClientRect = rect })
    const shownSteps = () => within(screen.getByRole('navigation', { name: 'Path' })).queryAllByRole('button')
      .filter((b) => !['Earlier steps', 'Later steps'].includes(b.getAttribute('aria-label') ?? '')).map((b) => b.getAttribute('aria-label') ?? b.textContent)

    test('shows whole steps only, the earlier ones that do not fit hidden behind "…"', () => {
      bar(2)
      expect(shownSteps()).toEqual(['North bay · B-104'])
      expect(screen.getByRole('button', { name: 'Earlier steps' })).toHaveTextContent('…')
    })

    test('"…" lists the hidden steps, and choosing one goes to it', async () => {
      const onStep = vi.fn()
      const user = userEvent.setup()
      bar(2, { onStep })
      await user.click(screen.getByRole('button', { name: 'Earlier steps' }))
      const menu = screen.getByRole('menu', { name: 'Earlier steps' })
      expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['List Bins', 'Filter Aisle: 4'])
      await user.click(within(menu).getByRole('menuitem', { name: 'List Bins' }))
      expect(onStep).toHaveBeenCalledWith(0)
    })

    test('at the first step, the steps after it that do not fit sit behind a "…" after it, not before', async () => {
      const onStep = vi.fn()
      const user = userEvent.setup()
      bar(0, { onStep })
      expect(screen.queryByRole('button', { name: 'Earlier steps' })).not.toBeInTheDocument()
      const nav = screen.getByRole('navigation', { name: 'Path' })
      const buttons = within(nav).getAllByRole('button')
      expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['List Bins', 'Later steps'])
      await user.click(screen.getByRole('button', { name: 'Later steps' }))
      const menu = screen.getByRole('menu', { name: 'Later steps' })
      expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Filter Aisle: 4', 'North bay · B-104'])
      await user.click(within(menu).getByRole('menuitem', { name: 'Filter Aisle: 4' }))
      expect(onStep).toHaveBeenCalledWith(1)
    })

    test('a two-word step longer than the whole bar keeps only its first word', () => {
      widths = [500]
      render(<PathBar steps={[{ key: 'a', label: 'Vellayani renewal' }]} current={0}
        onStep={() => {}} onBack={() => {}} onForward={() => {}} onCopyLink={() => {}} />)
      const step = within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button')
      expect(step).toHaveTextContent(/^Vellayani…$/)
      expect(step).toHaveAccessibleName('Vellayani renewal')
    })

    test('Escape closes the "…" menu', async () => {
      const user = userEvent.setup()
      bar(2)
      await user.click(screen.getByRole('button', { name: 'Earlier steps' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu', { name: 'Earlier steps' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Earlier steps' })).toHaveAttribute('aria-expanded', 'false')
    })

    test('a step longer than the whole bar is shortened at a word, its full name kept', () => {
      widths = [500]
      render(<PathBar steps={[{ key: 'a', label: 'Vellayani ground floor storage lease renewal' }]} current={0}
        onStep={() => {}} onBack={() => {}} onForward={() => {}} onCopyLink={() => {}} />)
      const step = within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button')
      expect(step).toHaveAccessibleName('Vellayani ground floor storage lease renewal')
      expect(step).toHaveAttribute('title', 'Vellayani ground floor storage lease renewal')
      expect(step.textContent).toMatch(/^(\S+ )*\S+…$/)
      expect('Vellayani ground floor storage lease renewal'.startsWith(step.textContent!.slice(0, -1))).toBe(true)
    })
  })

  test('a bar narrower than a wide window gives the path a line of its own under its buttons', () => {
    bar(2)
    const line = screen.getByRole('navigation', { name: 'Path' }).parentElement!
    const whole = screen.getByRole('button', { name: 'Back' }).parentElement!
    expect(whole.className).toMatch(/(^|\s)@container(\s|$)/)
    expect(whole.className).toMatch(/\bflex-wrap\b/)
    expect(line.className).toMatch(/@max-5xl:basis-full/)
  })

  test('Copied goes away after two seconds', () => {
    vi.useFakeTimers()
    try {
      bar(2)
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
      expect(screen.getByRole('status')).toHaveTextContent('Copied')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(screen.getByRole('status')).toHaveTextContent('')
    } finally { vi.useRealTimers() }
  })

  test('a path with no steps yet offers neither Back nor Forward', () => {
    render(<PathBar steps={[]} current={0} onStep={() => {}} onBack={() => {}} onForward={() => {}} onCopyLink={() => {}} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
    expect(within(screen.getByRole('navigation', { name: 'Path' })).queryAllByRole('button')).toEqual([])
  })

  test('a path that fits says nothing about earlier steps', () => {
    bar(0)
    expect(screen.queryByRole('button', { name: 'Earlier steps' })).not.toBeInTheDocument()
  })

  test('holds the recent paths slot', () => {
    bar(2)
    expect(screen.getByText('Recent slot')).toBeInTheDocument()
  })
})

describe('RecentPaths', () => {
  const paths = Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, label: `Path ${i + 1}` }))

  test('lists at most ten paths once opened', async () => {
    const user = userEvent.setup()
    render(<RecentPaths paths={paths} onPick={() => {}} />)
    const toggle = screen.getByRole('button', { name: 'Recent paths' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(screen.getAllByRole('menuitem')).toHaveLength(10)
  })

  test('picking a path reports its key and closes the menu', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<RecentPaths paths={paths} onPick={onPick} />)
    await user.click(screen.getByRole('button', { name: 'Recent paths' }))
    await user.click(screen.getByRole('menuitem', { name: 'Path 2' }))
    expect(onPick).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('RecentPaths closing', () => {
  const paths = [{ key: 'p1', label: 'Bins › Aisle 4' }]

  test('a click outside the menu closes it', async () => {
    const user = userEvent.setup()
    render(<><p>Elsewhere</p><RecentPaths paths={paths} onPick={() => {}} /></>)
    await user.click(screen.getByRole('button', { name: 'Recent paths' }))
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu', { name: 'Recent paths' })).not.toBeInTheDocument()
  })

  test('Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(<RecentPaths paths={paths} onPick={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Recent paths' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Recent paths' })).not.toBeInTheDocument()
  })
})

describe('TreeOutline', () => {
  const nodes: TreeNode[] = [
    { id: 'h-to', label: 'Links to', heading: true },
    { id: 'aisle', label: 'Aisle 4', kind: 'Aisle' },
    { id: 'centre', label: 'North bay', code: 'B-104', kind: 'Bin' },
    { id: 'h-from', label: 'Linked from', heading: true },
    { id: 'shelves', label: 'Shelf', group: true, count: 40, children: [
      { id: 's1', label: 'Top shelf', code: 'S-1', hasChildren: true },
      { id: 's2', label: 'Middle shelf', code: 'S-2' },
    ], more: { shown: 20, total: 40, onShowAll: vi.fn() } },
  ]
  function Tree({ onToggle = vi.fn(), onActivate = vi.fn(), open = [] as string[] }) {
    const [expanded, setExpanded] = useState(new Set(open))
    return <TreeOutline label="Around North bay" nodes={nodes} expanded={expanded} selected="centre" onActivate={onActivate}
      renderActions={(node) => node.id === 'centre' ? <button type="button">Focus here</button> : null}
      onToggle={(id) => {
        onToggle(id)
        setExpanded((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next })
      }} />
  }
  const item = (name: string) => screen.getByRole('treeitem', { name })

  test('headings are captions, not lines of the tree', () => {
    render(<Tree />)
    expect(screen.getByText('Links to')).toBeInTheDocument()
    expect(screen.queryByRole('treeitem', { name: 'Links to' })).not.toBeInTheDocument()
  })

  test('a caption inside an unfolded line is indented with its lines', () => {
    const nested: TreeNode[] = [{ id: 'row', label: 'Top shelf', children: [
      { id: 'row-h', label: 'Linked from', heading: true },
      { id: 'row-g', label: 'Stock count', group: true, count: 2 },
    ] }]
    render(<TreeOutline label="Shelves" nodes={nested} expanded={new Set(['row'])} onToggle={() => {}} onActivate={() => {}} />)
    expect(screen.getByText('Linked from').style.paddingInlineStart).toBe('1.25rem')
  })

  test('a line reads name · code with its level', () => {
    render(<Tree open={['shelves']} />)
    expect(item('Top shelf · S-1')).toHaveAttribute('aria-level', '2')
  })

  test('a group line shows its count and whether it is open', () => {
    render(<Tree />)
    expect(item('Shelf 40')).toHaveAttribute('aria-expanded', 'false')
  })

  test('only the selected line is in the tab order', () => {
    render(<Tree />)
    expect(screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)).toEqual([item('North bay · B-104')])
  })

  test('Down moves to the next line, past a heading', async () => {
    const user = userEvent.setup()
    render(<Tree />)
    item('North bay · B-104').focus()
    await user.keyboard('{ArrowDown}')
    expect(item('Shelf 40')).toHaveFocus()
  })

  test('Up moves to the previous line', async () => {
    const user = userEvent.setup()
    render(<Tree />)
    item('North bay · B-104').focus()
    await user.keyboard('{ArrowUp}')
    expect(item('Aisle 4')).toHaveFocus()
  })

  test('Right on a closed line asks to open it', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<Tree onToggle={onToggle} />)
    item('Shelf 40').focus()
    await user.keyboard('{ArrowRight}')
    expect(onToggle).toHaveBeenCalledWith('shelves')
  })

  test('Right on an open line enters its first child', async () => {
    const user = userEvent.setup()
    render(<Tree open={['shelves']} />)
    item('Shelf 40').focus()
    await user.keyboard('{ArrowRight}')
    expect(item('Top shelf · S-1')).toHaveFocus()
  })

  test('Left on a child goes to its parent', async () => {
    const user = userEvent.setup()
    render(<Tree open={['shelves']} />)
    item('Middle shelf · S-2').focus()
    await user.keyboard('{ArrowLeft}')
    expect(item('Shelf 40')).toHaveFocus()
  })

  test('Left on an open line closes it', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<Tree open={['shelves']} onToggle={onToggle} />)
    item('Shelf 40').focus()
    await user.keyboard('{ArrowLeft}')
    expect(onToggle).toHaveBeenCalledWith('shelves')
  })

  test('Home moves to the first line', async () => {
    const user = userEvent.setup()
    render(<Tree />)
    item('Shelf 40').focus()
    await user.keyboard('{Home}')
    expect(item('Aisle 4')).toHaveFocus()
  })

  test('End moves to the last line', async () => {
    const user = userEvent.setup()
    render(<Tree open={['shelves']} />)
    item('Aisle 4').focus()
    await user.keyboard('{End}')
    expect(item('Middle shelf · S-2')).toHaveFocus()
  })

  test('Down on the last line stays there', async () => {
    const user = userEvent.setup()
    render(<Tree />)
    item('Shelf 40').focus()
    await user.keyboard('{ArrowDown}')
    expect(item('Shelf 40')).toHaveFocus()
  })

  test('Right on a line with nothing under it leaves the key to the page', () => {
    render(<Tree />)
    // fireEvent answers false when a handler took the key (preventDefault).
    expect(fireEvent.keyDown(item('Aisle 4'), { key: 'ArrowRight' })).toBe(true)
    expect(item('Aisle 4')).not.toHaveAttribute('aria-expanded')
  })

  test('a key the tree does not use is left to the page', () => {
    render(<Tree />)
    expect(fireEvent.keyDown(item('Aisle 4'), { key: 'a' })).toBe(true)
  })

  test("a line's arrow opens it without choosing it", async () => {
    const onToggle = vi.fn()
    const onActivate = vi.fn()
    const user = userEvent.setup()
    render(<Tree onToggle={onToggle} onActivate={onActivate} />)
    await user.click(item('Shelf 40').querySelector('button')!)
    expect(onToggle).toHaveBeenCalledWith('shelves')
    expect(onActivate).not.toHaveBeenCalled()
    expect(item('Shelf 40')).toHaveAttribute('aria-expanded', 'true')
  })

  test('Enter activates the focused line', async () => {
    const onActivate = vi.fn()
    const user = userEvent.setup()
    render(<Tree onActivate={onActivate} />)
    item('Aisle 4').focus()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith('aisle')
  })

  test('clicking a line activates it', async () => {
    const onActivate = vi.fn()
    const user = userEvent.setup()
    render(<Tree onActivate={onActivate} />)
    await user.click(screen.getByText('Aisle 4'))
    expect(onActivate).toHaveBeenCalledWith('aisle')
  })

  test('a capped group offers to show all its rows', async () => {
    const user = userEvent.setup()
    render(<Tree open={['shelves']} />)
    expect(screen.getByText(/first 20/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'show all 40' }))
    expect(nodes[4].more!.onShowAll).toHaveBeenCalledOnce()
  })

  test('the selected line carries its actions', () => {
    render(<Tree />)
    expect(screen.getByRole('button', { name: 'Focus here' })).toBeInTheDocument()
    expect(item('North bay · B-104')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('UI Lab', () => {
  test.each([
    ['drill pane', 'Drill pane', 'packages/shop-floor/src/DrillPane.tsx'],
    ['tree', 'Tree outline', 'packages/shop-floor/src/TreeOutline.tsx'],
    ['path', 'Path bar', 'packages/shop-floor/src/PathBar.tsx'],
    ['go there', 'Link and group chips', 'packages/shop-floor/src/LinkChip.tsx'],
    ['empty fields', 'Field grid', 'packages/shop-floor/src/FieldGrid.tsx'],
    ['compact', 'Table or compact', 'packages/shop-floor/src/ViewToggle.tsx'],
  ])('searching "%s" finds the %s example', async (query, title, file) => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.type(screen.getByRole('searchbox', { name: 'Search components' }), query)
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    expect(screen.getByText(file)).toBeInTheDocument()
  })

  test("the path bar example's Recent paths menu is clipped by nothing around it", async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.type(screen.getByRole('searchbox', { name: 'Search components' }), 'path')
    await user.click(screen.getByRole('button', { name: 'Recent paths' }))
    const clipping: string[] = []
    for (let el = screen.getByRole('menu', { name: 'Recent paths' }).parentElement; el; el = el.parentElement)
      if (/\boverflow-(hidden|auto|x-auto|y-auto|clip)\b/.test(el.className)) clipping.push(el.className)
    expect(clipping).toEqual([])
  })

  test('section headings are sentence case, never all capitals', () => {
    render(<Gallery />)
    for (const heading of screen.getAllByRole('heading', { level: 2 })) expect(heading.className).not.toMatch(/\buppercase\b/)
  })
})

describe('UI Lab drill pane example', () => {
  test("Filter on the pane's Aisle says what the list behind would be filtered by", async () => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    const pane = screen.getByRole('complementary', { name: 'North bay · B-104' })
    await user.click(within(pane).getAllByRole('button', { name: 'Filter' })[0])
    expect(pane).toHaveTextContent('The list behind would now be filtered by Aisle: Aisle 4.')
  })

  test('opening or going to a linked row stays on the example', async () => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    const pane = screen.getByRole('complementary', { name: 'North bay · B-104' })
    for (const name of ['Aisle 4 · A-04', 'Riverside depot']) await user.click(within(pane).getByRole('button', { name }))
    for (const goThere of within(pane).getAllByRole('button', { name: 'Go there' })) await user.click(goThere)
    expect(screen.getByRole('complementary', { name: 'North bay · B-104' })).toBeInTheDocument()
  })

  test.each([
    ['Fields', 'Temperature zone'],
    ['Stock count 1,240', 'Stock counts would list here, 20 at a time.'],
  ])('choosing the %s group shows its rows', async (group, shows) => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    await user.click(screen.getByRole('button', { name: group }))
    expect(screen.getByRole('button', { name: group })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(shows)).toBeInTheDocument()
  })

  test('the Shelf group comes back after another group', async () => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    await user.click(screen.getByRole('button', { name: 'Fields' }))
    await user.click(screen.getByRole('button', { name: 'Shelf 3' }))
    expect(screen.getByRole('heading', { name: 'Shelf · 3 rows' })).toBeInTheDocument()
  })

  test('Compact lists each shelf by name and load', async () => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Top shelf · S-1').closest('li')).toHaveTextContent('Light cartons')
  })

  test('a closed pane can be opened again', async () => {
    const user = userEvent.setup()
    render(<DrillPaneDemo />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open the pane again' }))
    expect(screen.getByRole('complementary', { name: 'North bay · B-104' })).toBeInTheDocument()
  })
})

describe('UI Lab path bar example', () => {
  const current = () => screen.getByRole('navigation', { name: 'Path' }).querySelector('[aria-current="step"]')

  test('Back moves to the step before', async () => {
    const user = userEvent.setup()
    render(<PathBarDemo />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(current()).toHaveTextContent('North bay · B-104')
  })

  test('Forward moves to the step after', async () => {
    const user = userEvent.setup()
    render(<PathBarDemo />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Forward' }))
    expect(current()).toHaveTextContent('Top shelf · S-1')
  })

  test('Copy link says Copied', async () => {
    const user = userEvent.setup()
    render(<PathBarDemo />)
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })
})

describe('UI Lab chips example', () => {
  test.each([
    ['Aisle 4 · A-04', 0, 'Opened Aisle 4'],
    ['Go there', 0, 'Went to Aisle 4'],
    ['Filter', 0, 'Filtered by Aisle 4'],
    ['Riverside depot', 0, 'Opened Riverside depot'],
    ['Go there', 1, 'Went to Riverside depot'],
  ])('pressing %s (number %i) says what it would do', async (name, index, said) => {
    const user = userEvent.setup()
    render(<ChipsDemo />)
    await user.click(screen.getAllByRole('button', { name })[index])
    expect(screen.getByRole('status')).toHaveTextContent(said)
  })

  test('choosing a group marks it pressed', async () => {
    const user = userEvent.setup()
    render(<ChipsDemo />)
    await user.click(screen.getByRole('button', { name: 'Spare shelf 0' }))
    expect(screen.getByRole('button', { name: 'Spare shelf 0' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Shelf 3' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('UI Lab tree example', () => {
  const item = (name: string) => screen.getByRole('treeitem', { name })

  test('a line closes and opens again', async () => {
    const user = userEvent.setup()
    render(<TreeDemo />)
    item('Top shelf · S-1').focus()
    await user.keyboard('{ArrowLeft}')
    expect(item('Top shelf · S-1')).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowRight}')
    expect(item('Top shelf · S-1')).toHaveAttribute('aria-expanded', 'true')
  })

  test('show all lists every stock count', async () => {
    const user = userEvent.setup()
    render(<TreeDemo />)
    item('Stock count 8').focus()
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'show all 8' }))
    expect(screen.getAllByRole('treeitem', { name: /^Count / })).toHaveLength(8)
  })

  test('Focus here on another line brings the choice back to the bin', async () => {
    const user = userEvent.setup()
    render(<TreeDemo />)
    await user.click(screen.getByText('Riverside depot'))
    expect(item('Riverside depot')).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: 'Focus here' }))
    expect(item('North bay · B-104')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('GroupChip with no rows', () => {
  test('a group of 0 stays listed, quieter', () => {
    render(<GroupChip label="Shelf" count={0} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Shelf 0' })).toHaveAttribute('data-empty')
  })
})
