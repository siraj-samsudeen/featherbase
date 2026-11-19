// #1249: a wide list scrolls inside its own box, both ways, with its header row
// in view and an always-drawn scroll bar, and the list uses the page's full
// width. Pixels are the verifier's; these are the rules that make them.
import { screen } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

test("a list's table scrolls in its own box, its header row stays in view, and the list is not capped at 1280px", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Fit Note', columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Fit Note', row: { note: 'one' } })
  await renderApp('/featherbase/admin/table/fit-note', admin)
  const box = await screen.findByTestId('list-table-scroll', {}, { timeout: 10_000 })
  expect(box.className).toMatch(/\boverflow-auto\b/)
  expect(box.className).toMatch(/\bfeatherbase-scroll\b/)
  expect(box.querySelector('thead')!.className).toMatch(/\bsticky\b/)
  expect(box.querySelector('thead')!.className).toMatch(/\btop-0\b/)
  // The box is capped to the window (jsdom has no layout, so the least height shows).
  expect(box.style.maxHeight).toMatch(/^\d+px$/)
  const main = box.closest('main')!
  // #1348 board 2: the panel's padding is 24/28.
  expect(main.className).toContain('sm:px-7')
  expect(main.firstElementChild!.className).not.toMatch(/max-w-\[1280px\]/)
})
