// #1248: the rail's words: a row's initials, name and count (lib/sidebar-rail.ts).
import { expect, test } from 'vitest'
import { attachRailTips, railMark, railTip, rowLabel } from '../src/lib/sidebar-rail'

test('initials: two words give two letters, one word its first two, nothing gives nothing', () => {
  expect(railMark('Repair jobs')).toBe('RJ')
  expect(railMark('System')).toBe('Sy')
  expect(railMark('  ')).toBe('')
  expect(railMark('— / —')).toBe('')
})

test("a row's name leaves out its count and icon, or is its own aria-label", () => {
  const row = document.createElement('button')
  row.innerHTML = '<svg><title>x</title></svg><span>All tickets</span><span data-sidebar-count>12</span>'
  expect(rowLabel(row)).toBe('All tickets')
  expect(railTip(row)).toBe('All tickets · 12')
  row.setAttribute('aria-label', 'Every ticket')
  expect(rowLabel(row)).toBe('Every ticket')
})

test('a row with no words gets no tooltip', () => {
  const root = document.createElement('div')
  const row = document.createElement('button')
  root.append(row)
  document.body.append(root)
  const detach = attachRailTips({ root, layer: document.body, active: () => true, rowOf: () => row })
  row.dispatchEvent(new Event('pointerover', { bubbles: true }))
  expect(document.querySelector('[role=tooltip]')).toBeNull()
  detach()
  root.remove()
})
