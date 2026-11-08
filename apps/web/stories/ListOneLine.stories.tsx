// The Admin list, wide: every row one line, however long a value is (#1015,
// #1016, #1017; spec list-view "A list row is one line", "A list's controls
// leave the room to its rows"). The real list, router and components, with
// the server's answers replayed from stories/recordings/wide-list.json, so
// it runs without a server. Each story's play function is a layout test: it
// measures what only a real browser lays out. It replaces
// apps/web/e2e/list-one-line.spec.ts.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import recording from './recordings/wide-list.json'
import { AppScreen } from './AppScreen'
import { replay, type Recording } from './replay'

const wideList = recording as Recording

const meta: Meta<typeof AppScreen> = {
  title: 'Screens/List/One line per row',
  component: AppScreen,
  args: { recording: wideList },
  parameters: { msw: replay(wideList) },
}
export default meta
type Story = StoryObj<typeof meta>

const ROW_ONE_LINE = 44 // px: a row of one line of text, with its padding

/** Waits until the list has drawn its three rows. */
async function listShown(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await waitFor(() => expect(canvas.getByTestId('list-total')).toHaveTextContent('3 total'), { timeout: 15_000 })
  await waitFor(() => expect(canvas.getByTestId('list-rows').querySelectorAll('tr')).toHaveLength(3))
  return canvas
}

const rowHeights = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="list-rows"] tr')].map((r) => r.getBoundingClientRect().height)

export const EveryRowIsOneLine: Story = {
  name: 'Every row and the header are one line',
  play: async ({ canvasElement }) => {
    await listShown(canvasElement)
    const heights = rowHeights(canvasElement)
    await expect(Math.max(...heights)).toBeLessThan(ROW_ONE_LINE)
    // The last row alone has no line under it.
    await expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
    const header = canvasElement.querySelector('[data-testid="list-table-scroll"] thead tr')!
    await expect(header.getBoundingClientRect().height).toBeLessThan(ROW_ONE_LINE)
  },
}

export const LongValueIsClipped: Story = {
  name: 'A long value is clipped, and shows in full on hover',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    const note = canvas.getAllByTestId('cell-note').find((c) => c.textContent?.includes('canal road'))!
    const clip = note.closest('div')!
    await expect(clip.getBoundingClientRect().width).toBeLessThanOrEqual(321)
    await expect(getComputedStyle(clip).textOverflow).toBe('ellipsis')
    await userEvent.hover(clip)
    await waitFor(() => expect(clip.getAttribute('title')).toMatch(/^The site sits beside the old canal road/))
    const fits = canvas.getAllByTestId('cell-alpha')[0]!.closest('div')!
    await userEvent.hover(fits)
    await expect(fits).not.toHaveAttribute('title')
  },
}

export const MoreColumnsToTheRight: Story = {
  name: 'More columns to the right are signalled, and the name stays in view',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    const more = canvas.getByTestId('list-more-columns')
    const scroll = canvas.getByTestId('list-table-scroll')
    const name = within(canvas.getByTestId('list-rows')).getByRole('link', { name: 'Site 0' })
    const before = name.getBoundingClientRect().x
    await userEvent.click(within(more).getByRole('button'))
    await waitFor(() => expect(scroll.scrollLeft).toBeGreaterThan(0))
    scroll.scrollLeft = scroll.scrollWidth
    await waitFor(() => expect(canvas.queryByTestId('list-more-columns')).toBeNull())
    const after = name.getBoundingClientRect().x
    await expect(after).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().x)
    await expect(after).toBeLessThanOrEqual(before)
    // Nothing shows through the name column: its cell paints a solid colour.
    await expect(getComputedStyle(name.closest('td')!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  },
}

export const CompactFits: Story = {
  name: 'Compact fits without the sideways hint, and stays one line',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    await userEvent.click(within(canvas.getByRole('group', { name: 'List layout' })).getByRole('button', { name: 'Compact' }))
    await waitFor(() => expect(canvas.queryByTestId('list-more-columns')).toBeNull())
    await expect(Math.max(...rowHeights(canvasElement))).toBeLessThan(ROW_ONE_LINE)
    // When everything fits, a column is as wide as its content.
    const nameCell = canvasElement.querySelector('[data-testid="list-rows"] tr td:nth-child(2)')!
    await expect(nameCell.getBoundingClientRect().width).toBeLessThan(120)
  },
}

export const ShortValueKeepsOneLine: Story = {
  name: 'A short value keeps one line in full',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    const area = canvas.getAllByTestId('cell-area')[0]!
    await expect(area).toHaveTextContent('Tamil Nadu')
    const box = area.closest('div')!
    await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  },
}

export const FilterBoxesLineUp: Story = {
  name: 'The filter boxes line up',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    const boxes = [...canvas.getByTestId('standard-filters').querySelectorAll('input, select')].map((e) => {
      const r = e.getBoundingClientRect()
      return { top: r.top, height: r.height }
    })
    await expect(boxes).toHaveLength(4)
    for (const box of boxes) await expect(box).toEqual(boxes[0])
  },
}

export const FirstRowStartsHigh: Story = {
  name: 'The first row starts in the top two fifths of a desktop window',
  play: async ({ canvasElement }) => {
    await listShown(canvasElement)
    const row = canvasElement.querySelector('[data-testid="list-rows"] tr')!.getBoundingClientRect().top
    const notices = [...canvasElement.querySelectorAll('[data-testid="health-banner"], [data-testid="setup-banner"]')]
    const top = row - notices.reduce((sum, n) => sum + n.getBoundingClientRect().height, 0)
    await expect(top).toBeLessThanOrEqual(window.innerHeight * 0.4)
  },
}

export const WideFontStaysOnOneLine: Story = {
  name: 'A wider font keeps the filters and layout choices on one line',
  play: async ({ canvasElement }) => {
    const canvas = await listShown(canvasElement)
    const style = document.createElement('style')
    style.textContent = 'main * { font-family: "DejaVu Sans", Verdana, sans-serif !important }'
    document.head.appendChild(style)
    try {
      const filter = canvas.getByTestId('standard-filters').querySelector('input, select')!.getBoundingClientRect()
      const layout = canvas.getByRole('group', { name: 'List layout' }).getBoundingClientRect()
      await expect(layout.y).toBeLessThan(filter.y + filter.height)
    } finally {
      style.remove()
    }
  },
}
