// #1348 the calmer look: the shared primitives separate with fills and shadow, never a line. Board 1
// (Visual System) of docs/design/mockups/look-and-relationships.html. jsdom computes no stylesheet, so these
// read the class recipes; the verifier checks the drawn result against the boards.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  buttonClasses, cardClasses, cellClasses, Chip, chipHue, headCellClasses, iconButtonClasses, inputClasses, panelClasses, raisedClasses, Segmented, statusHue, tagClasses,
} from '@featherbase/shop-floor'

const classes = (s: string) => s.split(' ')
/** A border that draws a line: `border` with a colour other than transparent. */
const drawsALine = (c: string[]) => c.includes('border') && !c.includes('border-transparent')

describe('buttons are fills', () => {
  test('a secondary button is the quiet grey fill, with no edge, in 14/500', () => {
    const c = classes(buttonClasses())
    expect(c).toEqual(expect.arrayContaining(['bg-fill', 'hover:bg-fill-hover', 'font-medium']))
    expect(drawsALine(c)).toBe(false)
  })
  test('a button and an icon button show focus as the same 1.5px outline as an input', () => {
    expect(classes(buttonClasses())).toEqual(expect.arrayContaining(['focus-visible:outline-[1.5px]', 'focus-visible:outline-focus']))
    expect(classes(iconButtonClasses())).toEqual(expect.arrayContaining(['focus-visible:outline-[1.5px]', 'focus-visible:outline-focus']))
  })
  test('the primary button is the one blue fill', () => {
    expect(classes(buttonClasses({ variant: 'primary' }))).toEqual(expect.arrayContaining(['bg-action', 'border-transparent']))
  })
  test('a danger button is a red tint, not a red box', () => {
    const c = classes(buttonClasses({ variant: 'danger' }))
    expect(c).toEqual(expect.arrayContaining(['bg-negative-tint', 'text-negative']))
    expect(drawsALine(c)).toBe(false)
  })
  test('an open menu button is tinted, never outlined', () => {
    const c = classes(buttonClasses())
    expect(c).toEqual(expect.arrayContaining(['aria-expanded:bg-action-tint', 'aria-expanded:text-action']))
    expect(c).not.toContain('aria-expanded:border-action')
  })
})

describe('inputs are fills; focus is the only outline', () => {
  test('a text box is grey-filled with no edge', () => {
    const c = classes(inputClasses())
    expect(c).toEqual(expect.arrayContaining(['bg-fill', 'border-transparent']))
    expect(c).not.toContain('border-border-control')
  })
  test('focus draws a 1.5px outline in the focus colour, and no ring', () => {
    const c = classes(inputClasses())
    // outline-solid: focus:outline-hidden sets Tailwind's outline-style variable to none, which the width alone reads.
    expect(c).toEqual(expect.arrayContaining(['focus-visible:outline-[1.5px]', 'focus-visible:outline-solid', 'focus-visible:outline-focus']))
    expect(c.some((x) => x.includes('ring'))).toBe(false)
  })
  test('a field with an error still says so with a red edge', () => {
    expect(classes(inputClasses())).toContain('aria-invalid:border-negative')
  })
})

describe('surfaces', () => {
  test("a card inside a page is a quiet-fill block: no border, no shadow", () => {
    const c = classes(cardClasses())
    expect(c).toEqual(expect.arrayContaining(['rounded-card', 'bg-subtle']))
    expect(drawsALine(c)).toBe(false)
    expect(c.some((x) => x.startsWith('shadow'))).toBe(false)
  })
  test("the page's one panel is white, radius 14, with the panel shadow", () => {
    expect(classes(panelClasses())).toEqual(expect.arrayContaining(['rounded-card', 'bg-surface', 'shadow-panel']))
  })
  test('a raised surface (a menu, the pane, a hover card) floats on its shadow, with no border', () => {
    const c = classes(raisedClasses())
    expect(c).toEqual(expect.arrayContaining(['bg-surface', 'shadow-raised']))
    expect(drawsALine(c)).toBe(false)
  })
})

describe('the segmented control', () => {
  test('is a grey track with the chosen option raised in white', () => {
    render(<Segmented label="Rows" value="comfortable" onChange={() => {}}
      options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact Rows' }]} />)
    const track = classes(screen.getByRole('group', { name: 'Rows' }).className)
    expect(track).toEqual(expect.arrayContaining(['bg-fill', 'rounded-control']))
    expect(drawsALine(track)).toBe(false)
    const chosen = classes(screen.getByRole('button', { name: 'Comfortable' }).className)
    expect(chosen).toEqual(expect.arrayContaining(['aria-pressed:bg-surface', 'aria-pressed:shadow-pressed', 'aria-pressed:text-ink']))
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Compact Rows' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('chips with meaning', () => {
  test('a status reads green when live, amber when not yet, grey when finished, whatever its case', () => {
    expect(['Open', 'Active', 'live', 'Running', 'Success', 'OK'].map(statusHue)).toEqual(['green', 'green', 'green', 'green', 'green', 'green'])
    expect(['Planned', 'Draft', 'Pending'].map(statusHue)).toEqual(['amber', 'amber', 'amber'])
    expect(['Closed', 'Inactive', 'Done', 'Cancelled'].map(statusHue)).toEqual(['grey', 'grey', 'grey', 'grey'])
  })
  test("a category's tint comes from its name, so a value has the same colour everywhere", () => {
    expect(chipHue('Coastal')).toBe(chipHue('Coastal'))
    const eight = ['blue', 'teal', 'violet', 'pink', 'orange', 'lime', 'cyan', 'yellow']
    const seen = new Set(['Coastal', 'Inland', 'Cluster North', 'Cluster South', 'Cluster Hills', 'Apparel', 'Footwear', 'Home', 'Kids', 'Beauty'].map(chipHue))
    for (const hue of seen) expect(eight).toContain(hue)
    expect(seen.size).toBeGreaterThan(4)
  })
  test('a status chip is a pill with its dot; Compact Rows drops the dot and shrinks it', () => {
    const { rerender } = render(<Chip hue="green" dot>Open</Chip>)
    const chip = screen.getByText('Open')
    expect(classes(chip.className)).toEqual(expect.arrayContaining(['rounded-full', 'bg-chip-green', 'text-chip-green-ink', 'font-medium']))
    expect(chip.querySelector('[data-chip-dot]')).not.toBeNull()
    rerender(<Chip hue="green" dot compact>Open</Chip>)
    expect(screen.getByText('Open').querySelector('[data-chip-dot]')).toBeNull()
  })
})

test('the shared tag is #EEF0F3 with #374151 words, no border', () => {
  expect(classes(tagClasses())).toEqual(expect.arrayContaining(['bg-tag', 'text-tag-ink', 'rounded-md']))
})

describe('tables: a grey header band and rows told apart by space, never a line', () => {
  test('the header is a 36px quiet-fill band with a 12.5/500 grey label and rounded ends', () => {
    expect(classes(headCellClasses())).toEqual(expect.arrayContaining(['h-9', 'bg-subtle', 'px-3', 'text-[12.5px]', 'font-medium', 'text-ink-subtle']))
    expect(classes(headCellClasses({ first: true }))).toContain('rounded-l-lg')
    expect(classes(headCellClasses({ last: true }))).toContain('rounded-r-lg')
  })
  test('Comfortable rows are 44px with 14px text; Compact Rows are 32px with 13px text and a faint zebra', () => {
    expect(classes(cellClasses())).toEqual(expect.arrayContaining(['h-11', 'text-sm', 'px-3']))
    const compact = classes(cellClasses({ density: 'compact' }))
    expect(compact).toEqual(expect.arrayContaining(['h-8', 'text-[13px]', 'group-even:bg-subtle']))
    expect(classes(cellClasses())).not.toContain('group-even:bg-subtle')
  })
  test('the row under the pointer and the selected row are the hover tint, with rounded ends', () => {
    const c = classes(cellClasses({ first: true }))
    expect(c).toEqual(expect.arrayContaining(['group-hover:bg-hover', 'group-aria-selected:bg-hover', 'rounded-l-lg']))
    expect(classes(cellClasses({ last: true }))).toContain('rounded-r-lg')
  })
  test.each([
    'src/components/ListView.tsx', 'src/components/ListRows.tsx',
    '../../packages/shop-floor/src/Grid.tsx', '../../packages/shop-floor/src/DataList.tsx',
  ])('%s draws no row or column rule', (file) => {
    const text = readFileSync(join(__dirname, '..', file), 'utf8')
    expect(text).not.toMatch(/\bborder-[blr]\b(?!-)|\bborder-r\s|divide-y/)
  })
})

test('#1348 (UI owner): at phone width the list view tools wrap under the search instead of covering it', () => {
  const text = readFileSync(join(__dirname, '../src/components/ListView.tsx'), 'utf8')
  const row = /<div className="([^"]*)" data-testid="list-filter-row">\s*<div className="([^"]*)">/.exec(text)
  expect(row?.[1]).toMatch(/\bflex-wrap\b/)
  expect(row?.[2]).toMatch(/flex-\[1_1_20rem\]/)
  expect(text).toMatch(/max-w-full flex-wrap items-end gap-2 \$\{[^`]*`\} data-testid="list-view-tools"/)
})
