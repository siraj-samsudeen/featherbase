import { describe, expect, test } from 'vitest'
import { isSidebarAddress, mergeSidebarSections, namesDefaultPiece, sidebarSectionsUnder, type SidebarSection } from '../src/app-sidebar'

const row = (label: string, address = `?view=${label}`) => ({ label, address, icon: 'list' as const })

describe('mergeSidebarSections', () => {
  test('a runtime section fills the declared one of its id, after its own rows; the others follow; an empty one is not drawn', () => {
    const declared: SidebarSection[] = [
      { id: 'reports', title: 'Reports', items: [] },
      { id: 'work', title: 'Your Work', items: [row('sections')] },
      { id: 'empty', title: 'Nothing', items: [] },
    ]
    const runtime: SidebarSection[] = [
      { id: 'more', title: 'More', items: [row('more')] },
      { id: 'work', items: [row('approvals')] },
      { id: 'reports', title: 'Reports For You', icon: 'chart', items: [row('sales')] },
    ]
    expect(mergeSidebarSections(declared, runtime)).toEqual([
      { id: 'reports', title: 'Reports For You', icon: 'chart', items: [row('sales')] },
      { id: 'work', title: 'Your Work', items: [row('sections'), row('approvals')] },
      { id: 'more', title: 'More', items: [row('more')] },
    ])
  })
})

test('a declared address resolves under the app root, its nested rows too; a path stays', () => {
  expect(sidebarSectionsUnder('/tasker/', [{ id: 'a', items: [
    { ...row('inbox', '#page=inbox'), children: [{ label: 'One', address: '?project=1' }] },
    row('admin', '/featherbase/admin'),
  ] }])).toEqual([{ id: 'a', items: [
    { ...row('inbox', '/tasker/#page=inbox'), children: [{ label: 'One', address: '/tasker/?project=1' }] },
    row('admin', '/featherbase/admin'),
  ] }])
})

test('an address is a path on this site, or a query or hash; never another site or a script', () => {
  for (const address of ['?view=a', '#jobs', '/featherbase/admin/table/x', '/tasker/'])
    expect(isSidebarAddress(address)).toBe(true)
  for (const address of ['javascript:alert(1)', 'https://example.com', '//example.com', '/\\example.com', 'view', '? x', ''])
    expect(isSidebarAddress(address)).toBe(false)
})

test("a default piece's name, in any case, is the platform's", () => {
  expect(namesDefaultPiece(' recently opened ')).toBe(true)
  expect(namesDefaultPiece('Saved Views')).toBe(true)
  expect(namesDefaultPiece('Saved Reports')).toBe(false)
})
