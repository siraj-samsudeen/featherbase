// #1218: the business roles pages, rendered in a DOM (jsdom from apps/web) with the platform's answers
// played by a stand-in `fetch`; the reads themselves are proved in business-roles-server.test.ts and
// platform-test/business-roles.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: string; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
let answers: Record<string, unknown> = {}
let teardown: () => void = () => {}
let dom: { window: Record<string, unknown> & { close(): void } }

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => typeof dom }
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=explain&person=sm' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    const match = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))
    if (!match) return new Response('{}', { status: 404 })
    calls.push({ kind: match[1], name: match[2], payload: JSON.parse(String(init.body)).payload })
    const answer = answers[match[2]] as { __error?: string } | undefined
    if (answer?.__error) return new Response(JSON.stringify({ error: { message: answer.__error } }), { status: 417 })
    return new Response(JSON.stringify({ result: answers[match[2]] ?? (/^(manages|holds)_/.test(match[2]) ? false : []) }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const NONE = { kinds: [], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [] }
const SELVI = {
  person: 'sm', name: 'Selvi', who: { code: '3005', jobs: ['Store Manager · Lakeside'], staff: 'current' }, employee: '3005',
  header: { employee: [{ name: 'Selvi', table: 'Employee', id: '3005', code: '3005' }], sites: [{ name: 'Lakeside', table: 'Site', id: 'LKS' }], reports_to: [] },
  hr_titles: ['Operations Executive'],
  roles: [{ role: 'r-sm', name: 'Store Manager', source: 'From HR title', from: 'Store Manager', area: { parts: [{ name: 'Lakeside', table: 'Site', id: 'LKS' }], stores: 1, subcategories: null },
    until: null, reason: null, hand: null, hand_updated_at: null }],
  unmapped: [], apps: [{ app: 'Dash', level: 'Reader', via: ['Store Manager'] }, { app: 'Tasker', level: 'Manager', via: ['Store Manager'] }],
  reports: [{ key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'] }],
  today: { opens: true, reports: 1, stores: 1 }, next: { opens: true, reports: 1, stores: 1 }, change: NONE,
  choices: [{ id: 'r-sm', name: 'Store Manager' }, { id: 'r-tl', name: 'Team Leader' }],
  places: { stores: [{ id: 'HIL', name: 'Hillview' }, { id: 'LKS', name: 'Lakeside' }], default: 'LKS' },
}
beforeEach(() => { calls.length = 0; document.body.innerHTML = ''; answers = { explain_person: SELVI, give_role: { id: 'h1' } } })

async function render(element: 'explain' | 'roles' | 'changes') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const pages = await import('./roles-page')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const Page = element === 'explain' ? pages.ExplainPersonPage : element === 'roles' ? pages.BusinessRolesPage : pages.AccessChangesPage
  await act(async () => { createRoot(container).render(<Page />) })
  await settle()
  const all = (testid: string) => [...container.querySelectorAll(`[data-testid="${testid}"]`)]
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
  const set = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await act(async () => {
      const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
    await settle()
  }
  return { container, all, click, set }
}

describe('Explain A Person', () => {
  it('shows a role with its area and source chip', async () => {
    const { all } = await render('explain')
    expect(all('explain-role').map(line => [line.querySelector('[data-testid="role-area"]')!.textContent, line.querySelector('[data-testid="source-chip"]')!.textContent]))
      .toEqual([['Lakeside', 'From HR title']])
  })

  it('opens a report\'s Why? only when asked', async () => {
    const { all, click } = await render('explain')
    const report = all('explain-report')[0]
    const before = report.querySelectorAll('[data-testid="why-line"]').length
    await click(report.querySelector('[data-testid="why-toggle"]')!)
    expect([before, all('explain-report')[0].querySelector('[data-testid="why-line"]')!.textContent]).toEqual([0, 'Given to Store Manager, for Lakeside'])
  })

  it('reads the designation as the HR title, with Employee and Site chips in the header', async () => {
    const { all } = await render('explain')
    expect([all('hr-title')[0].textContent, all('header-chip').map(c => c.textContent)]).toEqual(['Operations Executive', ['Employee Selvi 3005', 'Site Lakeside']])
  })

  it('draws the source chip in the action tint', async () => {
    const { all } = await render('explain')
    expect(all('source-chip')[0].getAttribute('data-tone')).toBe('source')
  })

  it('says the new model gives the same when nothing changes', async () => {
    const { all } = await render('explain')
    expect(all('explain-change')[0].textContent).toBe('Nothing: the new model gives the same.')
  })

  it('also gives a role with an end date, then reads the person again', async () => {
    const { all, click, set } = await render('explain')
    await click(all('also-give-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-tl')
    await set(all('hand-ends')[0] as HTMLInputElement, '2027-03-31')
    await click(all('hand-save')[0])
    expect([calls.find(c => c.name === 'give_role')?.payload, calls.filter(c => c.name === 'explain_person').length])
      .toEqual([{ person: 'sm', change: 'Also give', role: 'r-tl', site: 'LKS', ends_on: '2027-03-31', reason: '' }, 2])
  })

  it('offers the job\'s place by default in a Correct, said as a sentence', async () => {
    const { all, click, set } = await render('explain')
    await click(all('correct-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-sm')
    expect([(all('hand-site')[0] as HTMLSelectElement).value, all('hand-sentence')[0].textContent]).toEqual(['LKS', 'Correct: treat as Store Manager at Lakeside.'])
  })

  it('lists only the decisions the comparison makes', async () => {
    answers.explain_person = { ...SELVI, change: { ...NONE, kinds: ['decision'], decisions: [{ name: 'Sales', table: 'dash.report', id: 'sales' }] } }
    const { all } = await render('explain')
    expect(all('explain-decision').map(l => l.textContent)).toEqual(['Sales'])
  })

  it('says plainly that only a manager may see it, with no search above', async () => {
    answers = { explain_person: { __error: 'Only a Report Access Manager or a System Manager can see business roles' } }
    const { all } = await render('explain')
    expect([all('refused')[0].textContent!.includes('Only a Report Access Manager or System Manager can see this'), all('person-search').length]).toEqual([true, 0])
  })

  it('reads No current job as the HR title of someone with none', async () => {
    answers.explain_person = { ...SELVI, hr_titles: [] }
    const { all } = await render('explain')
    expect(all('hr-title')[0].textContent).toBe('No current job')
  })

  it('asks on the line before removing a hand change, and keeps it on Keep', async () => {
    const given = { ...SELVI.roles[0], source: 'Also given by hand', hand: 'h1', hand_updated_at: 'u' }
    answers.explain_person = { ...SELVI, roles: [given] }
    const { all, click } = await render('explain')
    await click(all('remove-role')[0])
    const asked = all('remove-confirm')[0].textContent
    await click(all('remove-keep')[0])
    expect([asked, calls.some(c => c.name === 'remove_role'), all('remove-role').length]).toEqual(['Remove this?YesKeep', false, 1])
  })

  it('removes a hand change on Yes', async () => {
    const given = { ...SELVI.roles[0], source: 'Also given by hand', hand: 'h1', hand_updated_at: 'u' }
    answers.explain_person = { ...SELVI, roles: [given] }
    answers.remove_role = { removed: 'h1' }
    const { all, click } = await render('explain')
    await click(all('remove-role')[0])
    await click(all('remove-yes')[0])
    expect(calls.find(c => c.name === 'remove_role')?.payload).toEqual({ id: 'h1', updated_at: 'u' })
  })

  it('says whether they are an Employee, a Former Employee or External', async () => {
    const { all } = await render('explain')
    expect(all('staff-badge').map(b => b.textContent)).toEqual(['Employee'])
  })
})

describe('Business Roles', () => {
  const ROLES = { business_roles: {
    roles: [{ id: 'r-sm', name: 'Store Manager', description: 'Runs a store.', by_hand_only: false, reaches: 'their store', permissions: [
      { app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', sentence: 'Store Managers can Edit Sections in their Area' },
      { app: 'Dash', level: 'Manager', verb: 'Give', thing: 'Reports', reach: 'Team', sentence: 'Store Managers can Give Reports for their Team' }] }],
    titles: [{ title: 'Operations Executive', role: null, role_name: null, people: 3, falls_back_to: 'Store Manager', holders: [{ person: 'p1', name: 'Sundar' }] },
      { title: 'Store Manager', role: 'r-sm', role_name: 'Store Manager', people: 4, holders: [] }],
  } }

  it('opens a role as a grid: things as rows, a reach chip under its verb, other verbs on the row', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('role-open')[0])
    expect(all('grid-row').map(row => [row.querySelector('[data-testid="cell-Edit"]')!.textContent, row.textContent!.includes('Give')]))
      .toEqual([['Area', false], ['—', true]])
  })

  it('says how far a role reaches in plain words', async () => {
    answers = ROLES
    const { all } = await render('roles')
    expect(all('role-reaches')[0].textContent).toBe('Reaches: their store')
  })

  it('colours each reach by its word', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('role-open')[0])
    expect(all('reach-chip').map(c => [c.textContent, c.className.includes('positive') || c.className.includes('action')])).toEqual([['Area', true], ['Team', true]])
  })

  it('lists titles not mapped yet first, and opens who holds one', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('unmapped-line')[0].querySelector('[data-testid="holders-toggle"]')!)
    expect([all('unmapped-line').map(l => l.querySelector('.font-medium')!.textContent), all('holders')[0].querySelector('a')!.getAttribute('href')])
      .toEqual([['Operations Executive'], '?view=explain&person=p1'])
  })
})

describe('Who Would Gain Or Lose Access', () => {
  it('lists only people with a difference, with a count per kind', async () => {
    answers = { access_changes: { people: 3, changed: 1, groups: [
      { kind: 'loses_dash', people: [{ person: 'st', name: 'Siva', who: null, kinds: ['loses_dash'], roles: ['Staff'], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [] }] },
      { kind: 'gains_dash', people: [] }, { kind: 'stores', people: [] }, { kind: 'reports', people: [] }, { kind: 'decision', people: [] }] } }
    const { all } = await render('changes')
    expect([all('changed-name').map(a => [a.textContent, a.getAttribute('href')]), all('group-loses_dash-count')[0].textContent])
      .toEqual([[['Siva', '?view=explain&person=st']], '1'])
  })
})

describe('a bundle\'s record link', () => {
  it('opens Report access on that bundle, marked', async () => {
    const { showBundleInAddress } = await import('./access-page')
    window.history.replaceState(null, '', '/dash/?view=access&section=bundles&bundle=b2')
    document.body.innerHTML = '<div data-bundle-id="b1"></div><div data-bundle-id="b2"></div>'
    showBundleInAddress()
    expect([...document.querySelectorAll('[aria-current]')].map(el => el.getAttribute('data-bundle-id'))).toEqual(['b2'])
  })

  it('marks nothing when the address names no bundle', async () => {
    const { showBundleInAddress } = await import('./access-page')
    window.history.replaceState(null, '', '/dash/?view=access')
    document.body.innerHTML = '<div data-bundle-id="b1"></div>'
    showBundleInAddress()
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
})
