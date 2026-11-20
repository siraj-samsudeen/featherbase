// #1348 fix-forward (UI owner): a menu item is a row, not a button. Items are left-aligned text on no fill,
// the hover tint under the pointer or keyboard focus, one line each; the menu is as wide as its longest item
// (at least 200px). Groups are set apart by space, never a line. jsdom draws no stylesheet, so these read the
// class recipe and the classes the real menus put on their items; the verifier checks the drawn result.
import { configure, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect } from 'vitest'
import { test as plain } from 'vitest'
import { menuClasses, menuItemClasses } from '@featherbase/shop-floor'
import { rowHref, tableHref } from 'shared'
import { test, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const classes = (s: string) => s.split(' ')
const FILLS = ['bg-fill', 'bg-negative-tint', 'bg-action', 'bg-surface', 'bg-subtle']

describe('the shared menu item', () => {
  plain('is a left-aligned 34px row on no fill, the hover tint under the pointer or focus, radius 8, one line', () => {
    const c = classes(menuItemClasses())
    expect(c).toEqual(expect.arrayContaining([
      'text-left', 'justify-start', 'min-h-[34px]', 'rounded-lg', 'whitespace-nowrap', 'hover:bg-hover', 'focus-visible:bg-hover',
      'focus-visible:outline-[1.5px]', 'focus-visible:outline-focus',
    ]))
    expect(c.filter((x) => FILLS.includes(x))).toEqual([])
    expect(c.some((x) => x === 'border' || x.startsWith('border-'))).toBe(false)
  })
  plain('a destructive item is red words on the same quiet row', () => {
    const c = classes(menuItemClasses({ tone: 'negative' }))
    expect(c).toContain('text-negative')
    expect(c).not.toContain('text-ink')
    expect(c.filter((x) => FILLS.includes(x))).toEqual([])
  })
  plain('the menu sizes to its longest item, at least 200px, and floats with no border', () => {
    const c = classes(menuClasses())
    expect(c).toEqual(expect.arrayContaining(['w-max', 'min-w-[200px]', 'bg-raised', 'shadow-raised']))
    expect(c.some((x) => x === 'border' || x.startsWith('border-'))).toBe(false)
  })
})

/** Every action in an open menu, ignoring the inline forms some items open. */
const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('a, button')).filter((el) => !el.closest('form, [role="dialog"]'))

describe("the real menus draw their items as rows", () => {
  test('the list\'s View and More menus', async ({ admin }) => {
    await seedSites(admin)
    await renderApp(tableHref(SITE), admin)
    for (const label of ['View', 'More']) {
      fireEvent.click(await screen.findByRole('button', { name: label }))
      const menu = screen.getByRole('group', { name: label })
      expect(classes(menu.className)).toEqual(expect.arrayContaining(['w-max', 'min-w-[200px]']))
      const found = items(menu)
      expect(found.length).toBeGreaterThan(0)
      for (const item of found) {
        expect(classes(item.className), item.textContent ?? '').toEqual(expect.arrayContaining(['whitespace-nowrap', 'hover:bg-hover']))
        expect(classes(item.className).filter((x) => FILLS.includes(x)), item.textContent ?? '').toEqual([])
      }
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
  })
  test("a record's Record actions menu, its Delete in red words", async ({ admin }) => {
    await seedSites(admin)
    await renderApp(rowHref(SITE, 'ENK'), admin)
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }))
    const menu = screen.getByRole('group', { name: 'Record actions' })
    for (const item of items(menu)) {
      expect(classes(item.className), item.textContent ?? '').toContain('whitespace-nowrap')
      expect(classes(item.className).filter((x) => FILLS.includes(x)), item.textContent ?? '').toEqual([])
    }
    expect(classes(within(menu).getByTestId('form-delete').className)).toContain('text-negative')
  })
  test('Record actions keeps its two deletes in a group of their own at the bottom, set apart by space', async ({ admin }) => {
    await seedSites(admin)
    await renderApp(rowHref(SITE, 'ENK'), admin)
    fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }))
    const menu = screen.getByRole('group', { name: 'Record actions' })
    const danger = within(menu).getByRole('group', { name: 'Delete' })
    expect(menu.lastElementChild).toBe(danger)
    expect(classes(danger.className)).toEqual(expect.arrayContaining(['mt-2', 'first:mt-0']))
    expect(within(danger).getAllByRole('button').map((b) => b.textContent)).toEqual(['Delete With History…', 'Delete'])
    expect(within(menu).getByRole('group', { name: 'Record' })).toHaveTextContent(/Print.*Rename.*Retire/)
  })
})
