// #1218, #1340: Dash's business roles pages (Explain A Person, Who Would Gain Or Lose Access, the roles grid), rendered in a DOM (jsdom from apps/web) with the platform's answers
// played by a stand-in `fetch`; the reads themselves are proved in business-roles-server.test.ts and
// platform-test/business-roles.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: string; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
/** #1282: made-up places, as the platform's list read answers them. */
const TABLES: Record<string, Record<string, unknown>[]> = {
  Cluster: [{ row_id: 'cs', name: 'Chennai South' }, { row_id: 'no', name: 'North' }],
  Site: [{ row_id: 'SE', name: 'Store E', cluster: 'cs', is_store: 1 }, { row_id: 'SF', name: 'Store F', cluster: 'cs', is_store: 1 }, { row_id: 'WH', name: 'Warehouse', cluster: 'cs', is_store: 0 }],
  'Store Floor': [{ row_id: 'SE1', name: 'First floor', site: 'SE' }],
}
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
    // #1282: the platform's list read, for the area picker's columns.
    const listed = /\/api\/table\/([^?]+)\?(.*)$/.exec(String(url))
    if (listed) {
      const query = new URLSearchParams(listed[2])
      const filters = JSON.parse(query.get('filters') ?? '[]') as [string, string, unknown][]
      const rows = (TABLES[decodeURIComponent(listed[1]!)] ?? []).filter(r => filters.every(([c, , v]) => r[c] === v))
      return new Response(JSON.stringify({ data: rows.slice(0, Number(query.get('limit_page_length') ?? 500)), total: rows.length }), { status: 200 })
    }
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

async function render(element: 'explain' | 'grid' | 'changes') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const Page = element === 'explain' ? (await import('./explain-person-page')).ExplainPersonPage
    : element === 'grid' ? (await import('./roles-grid-page')).RolesGridPage : (await import('./access-changes-page')).AccessChangesPage
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
      .toEqual([['Lakeside', 'from HR title']])
  })

  it('opens a report\'s Why? only when asked', async () => {
    const { all, click } = await render('explain')
    const report = all('explain-report')[0]
    const before = report.querySelectorAll('[data-testid="why-line"]').length
    await click(report.querySelector('[data-testid="why-toggle"]')!)
    expect([before, all('explain-report')[0].querySelector('[data-testid="why-line"]')!.textContent]).toEqual([0, 'Selvi → Given to Store Manager, for Lakeside'])
  })

  // #1340: each report and app says the role it comes through, as a chip, beside its locked tick.
  it('says which role each report and app comes through, each a locked tick', async () => {
    const { all } = await render('explain')
    expect(all('explain-report')[0].querySelector('[data-testid="source-chip"]')!.textContent).toBe('via Store Manager')
    expect(all('explain-app').map(a => a.querySelector('[data-testid="source-chip"]')!.textContent)).toEqual(['via Store Manager', 'via Store Manager'])
    expect(all('explain-role')[0].querySelector('[data-testid="tick-locked"]')).not.toBeNull()
  })

  it('lists each app once, its levels together', async () => {
    answers.explain_person = { ...SELVI, apps: [{ app: 'Dash', level: 'Manager', via: ['Store Manager'] }, { app: 'Dash', level: 'Reader', via: ['Team Leader'] }] }
    const { all } = await render('explain')
    expect(all('explain-app').map(a => a.querySelector('[data-testid="link-line-note"]')!.textContent)).toEqual(['at levels Manager and Reader'])
    expect(all('explain-app')[0]!.querySelectorAll('[data-testid="source-chip"]').length).toBe(2)
  })

  // #1340: the person's header as on a record page, and the answer first.
  it('heads the page with the person, as a record page does, and answers first that nothing changes', async () => {
    const { all } = await render('explain')
    expect(all('explain-subtitle')[0].textContent).toBe('Person · Employee · Store Manager · Lakeside')
    expect(all('explain-answer')[0].textContent).toBe('Nothing changes for Selvi. Today and with business roles: Dash opens · 1 report · 1 store.')
  })

  it('answers first with what changes, when something does', async () => {
    answers.explain_person = { ...SELVI, next: { opens: false, reports: 0, stores: 0 }, change: { ...NONE, kinds: ['loses_dash'] } }
    const { all } = await render('explain')
    expect(all('explain-answer')[0].textContent).toBe('With business roles, Selvi changes: Would lose Dash.')
    expect(all('explain-next')[0].textContent).toBe('No Dash · 0 reports · 0 stores')
  })

  // #1340: Give A Role… on Who Would Gain Or Lose Access opens this page with Also Give open.
  it('opens Also Give at once when sent here to give a role', async () => {
    window.history.replaceState(null, '', '/dash/?view=explain&person=sm&give=1')
    try {
      const { all } = await render('explain')
      expect(all('hand-sentence')[0].textContent).toBe('Also give: treat as the role at Lakeside.')
    } finally { window.history.replaceState(null, '', '/dash/?view=explain&person=sm') }
  })

  it('reads the designation as the HR title, with Employee and Site chips in the header', async () => {
    const { all } = await render('explain')
    expect([all('hr-title')[0].textContent, all('header-chip').map(c => c.textContent)]).toEqual(['Operations Executive', ['Employee Selvi 3005', 'Site Lakeside']])
  })

  it('draws a role from HR in the action tint, and one given by hand in the caution tint', async () => {
    answers.explain_person = { ...SELVI, roles: [SELVI.roles[0], { ...SELVI.roles[0], role: 'r-tl', name: 'Team Leader', source: 'Also given by hand', hand: 'h1', hand_updated_at: 'u' }] }
    const { all } = await render('explain')
    expect(all('explain-role').map(r => [r.querySelector('[data-testid="source-chip"]')!.textContent, r.querySelector('[data-testid="source-chip"]')!.getAttribute('data-tone')]))
      .toEqual([['from HR title', 'neutral'], ['given by hand', 'caution']])
  })

  it('says Nothing changes in its field when nothing does', async () => {
    const { all } = await render('explain')
    expect(all('explain-change')[0].textContent).toBe('Nothing')
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

  // #1282 G1: the place picked on the trees, a store; a cluster shows but cannot be given yet.
  it('picks the place on the trees: a cluster walks to its stores, and a store becomes the place', async () => {
    const { all, click, set } = await render('explain')
    await click(all('also-give-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-tl')
    await click(all('hand-pick-area')[0])
    const button = (text: string) => [...document.querySelectorAll('[data-testid="area-picker"] button')].find(b => b.textContent?.startsWith(text))!
    // Two stores under Chennai South: its warehouse is no store.
    expect(button('Chennai South').textContent).toBe('Chennai South2 stores')
    await click(button('Chennai South'))
    expect(all('area-not-yet')[0].textContent).toBe('Can be given at Store level for now')
    expect((button('Use Chennai South') as HTMLButtonElement).disabled).toBe(true)
    await click(button('Store E'))
    await click(button('Use Store E'))
    expect([all('area-picker').length, all('hand-sentence')[0].textContent]).toEqual([0, 'Also give: treat as Team Leader at Store E.'])
    await click(all('hand-save')[0])
    expect(calls.find(c => c.name === 'give_role')?.payload).toMatchObject({ site: 'SE' })
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

  // #1316: with no person chosen there is no explanation to refuse; the page asks first whether this viewer may use it.
  it('refuses plainly before anyone is chosen, to someone who may not use it', async () => {
    window.history.replaceState(null, '', '/dash/?view=explain')
    try {
      answers = { manages_roles: false }
      const refused = await render('explain')
      expect([refused.all('refused').length, refused.all('person-search').length]).toEqual([1, 0])
      answers = { manages_roles: true }
      const allowed = await render('explain')
      expect([allowed.all('refused').length, allowed.all('person-search').length]).toEqual([0, 1])
    } finally { window.history.replaceState(null, '', '/dash/?view=explain&person=sm') }
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

/** The Business Roles view switch (the shared Segmented control), in the page rendered last. */
const viewButton = (name: string) =>
  [...[...document.querySelectorAll('[role="group"][aria-label="Show the grid of"]')].at(-1)!.querySelectorAll('button')].find(b => b.textContent === name)!

describe('Business Roles Grid', () => {
  const ROLES = { business_roles: {
    may_change: false, may_give_reports: true,
    report_catalog: [{ table: 'dash.report', key: 'vs', name: 'Visit Sales' }, { table: 'dash.report_bundle', key: 'b1', name: 'Store pack' }],
    roles: [{ id: 'r-sm', name: 'Store Manager', description: 'Runs a store.', by_hand_only: false, reaches: 'their store', permissions: [
      { app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', sentence: 'Store Managers can Edit Sections in their area',
        parts: [{ record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Managers' } }, ' can Edit Sections ', { chip: 'in their area' }] },
      { app: 'Dash', level: 'Manager', verb: 'Give', thing: 'Reports', reach: 'Team', sentence: 'Store Managers can Give Reports for their team',
        parts: [{ record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Managers' } }, ' can Give Reports ', { chip: 'for their team' }] }],
      reports: [[{ record: { table: 'dash.report', row: 'vs', name: 'Visit Sales' } }, ' is given to ', { record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Manager' } }, ' ', { chip: 'each in their own area' }]],
      given: ['dash.report|vs'], people: 25, people_from: 'from HR title and by hand', holders: [{ person: 'p1', name: 'Sundar' }] }],
    titles: [{ title: 'Operations Executive', role: null, role_name: null, people: 3, falls_back_to: 'Store Manager', holders: [{ person: 'p1', name: 'Sundar' }] },
      { title: 'Store Manager', role: 'r-sm', role_name: 'Store Manager', people: 4, holders: [] }],
  } }

  // #1282 F1–F6: the grid. Store Manager holds two permissions; Team Leader none yet.
  const GRID = (mayChange = true, extra: unknown[] = []) => ({ business_roles: { ...ROLES.business_roles, may_change: mayChange, roles: [
    ROLES.business_roles.roles[0]!,
    { ...ROLES.business_roles.roles[0]!, id: 'r-tl', name: 'Team Leader', permissions: [], reports: [], given: [], people: 3, holders: [{ person: 'p9', name: 'Tara' }] },
    ...extra,
  ] } })
  const cellButton = (all: (t: string) => Element[], row: string, role: string) =>
    all(`grid-cell-Dash / Manager / ${row.split(' ').join(' / ')}-${role}`)[0]!.querySelector('button')!

  it('shows the roles as a grid: permissions grouped by app, a header linking each role, a reach in each cell', async () => {
    answers = GRID()
    const { all, click } = await render('grid')
        expect(all('grid-row-title').map(t => t.textContent)).toEqual(['Give Reports · Manager', 'Edit Sections · Manager'])
    expect(all('grid-group').map(g => g.textContent)).toEqual(['Dash'])
    // Each header is the role's record link (plain words here, where this stand-in platform says it may not be opened).
    expect(all('grid-header').map(h => [h.textContent, h.querySelector('[data-table="dash.business_role"]')?.getAttribute('data-row')])).toEqual([['Store Manager', 'r-sm'], ['Team Leader', 'r-tl']])
    expect([cellButton(all, 'Edit Sections', 'r-sm').textContent, cellButton(all, 'Edit Sections', 'r-tl').textContent]).toEqual(['Area', '—'])
    expect(cellButton(all, 'Edit Sections', 'r-sm').getAttribute('title')).toBe('Store Managers can edit sections — in their area')
    expect(cellButton(all, 'Edit Sections', 'r-tl').getAttribute('title')).toBe("Team Leaders can't edit sections")
  })

  it('steps a cell, waits with the dark bar, and Discard puts it back; stepping back to the saved value is no change', async () => {
    answers = GRID()
    const { all, click } = await render('grid')
        await click(cellButton(all, 'Edit Sections', 'r-tl'))
    await click(cellButton(all, 'Edit Sections', 'r-sm'))
    expect(all('pending-bar')[0]!.textContent).toContain('2 changes waiting · affects about 28 people')
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Discard')!)
    expect([all('pending-bar').length, cellButton(all, 'Edit Sections', 'r-sm').textContent]).toEqual([0, 'Area'])
    for (let i = 0; i < 5; i++) await click(cellButton(all, 'Edit Sections', 'r-tl'))
    expect([cellButton(all, 'Edit Sections', 'r-tl').textContent, all('pending-bar').length]).toEqual(['—', 0])
  })

  it('reviews each change as a sentence, old → new, with the people it touches, and saves them whole', async () => {
    answers = { ...GRID(), change_permissions: { saved: 2 } }
    const { all, click } = await render('grid')
        await click(cellButton(all, 'Edit Sections', 'r-tl'))
    await click(cellButton(all, 'Edit Sections', 'r-sm'))
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Review and save')!)
    expect(all('review-line').map(l => l.textContent)).toEqual(['Team Leaders · Edit Sections: not given → their own', 'Store Managers · Edit Sections: in their area → everywhere'])
    expect(all('review-line')[0]!.querySelector('[data-table="dash.business_role"]')?.getAttribute('data-row')).toBe('r-tl')
    await click(all('review-people')[0]!)
    expect(all('review-names')[0]!.textContent).toBe('Tara, Sundar and 26 more')
    await click(all('review-back')[0]!)
    expect(all('pending-bar')[0]!.textContent).toContain('2 changes waiting')
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Review and save')!)
    const before = calls.filter(c => c.name === 'business_roles').length
    await click(all('review-save')[0]!)
    expect(calls.find(c => c.name === 'change_permissions')!.payload).toEqual({ changes: [
      { role: 'r-tl', app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', from: null, to: 'Own' },
      { role: 'r-sm', app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', from: 'Area', to: 'All' },
    ] })
    expect([calls.filter(c => c.name === 'business_roles').length > before, all('grid-review').length, all('pending-bar').length]).toEqual([true, 0, 0])
  })

  it('says why a save is refused, and keeps the changes to review again', async () => {
    answers = { ...GRID(), change_permissions: { __error: 'Store Manager · Dash · Manager · Edit Sections was changed since you loaded the grid; reload it and try again' } }
    const { all, click } = await render('grid')
        await click(cellButton(all, 'Edit Sections', 'r-sm'))
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Review and save')!)
    await click(all('review-save')[0]!)
    expect(all('grid-review')[0]!.textContent).toContain('was changed since you loaded the grid')
  })

  it('is read-only for someone who may not change it: no stepping, no bar', async () => {
    answers = GRID(false)
    const { all, click } = await render('grid')
        expect([all('permissions-grid')[0]!.querySelectorAll('button').length, all('grid-cell-Dash / Manager / Edit / Sections-r-sm')[0]!.textContent]).toEqual([0, 'Area'])
  })

  it('asks before leaving the grid with changes waiting, and before the page is closed', async () => {
    answers = GRID()
    const { all, click } = await render('grid')
        await click(cellButton(all, 'Edit Sections', 'r-tl'))
    const unload = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await click(viewButton('Reports'))
    expect(all('permissions-grid').length).toBe(1)
    await click(viewButton('Reports'))
    expect([confirm.mock.calls[0]![0], all('permissions-grid').length, all('reports-grid').length]).toEqual(['Leave the grid? Your change will not be saved.', 0, 1])
    confirm.mockRestore()
  })

  // Verifier on the grid: the same verb and thing at two levels reads with its level, so two changes never read alike.
  it('names the level in a review sentence where the same thing is changed at two levels', async () => {
    const atTwo = { ...ROLES.business_roles.roles[0]!, permissions: [...ROLES.business_roles.roles[0]!.permissions,
      { app: 'Dash', level: 'Reader', verb: 'Edit', thing: 'Sections', reach: 'Own', sentence: '', parts: [] }] }
    answers = { business_roles: { ...GRID().business_roles, roles: [atTwo] } }
    const { all, click } = await render('grid')
        await click(cellButton(all, 'Edit Sections', 'r-sm'))
    await click(all('grid-cell-Dash / Reader / Edit / Sections-r-sm')[0]!.querySelector('button')!)
    await click(cellButton(all, 'Give Reports', 'r-sm'))
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Review and save')!)
    expect(all('review-line').map(l => l.textContent)).toEqual(expect.arrayContaining([
      'Store Managers · Edit Sections (Manager): in their area → everywhere', 'Store Managers · Edit Sections (Reader): their own → for their team',
      'Store Managers · Give Reports: for their team → in their area']))
  })

  // UI owner: the reports grid, a tick in each cell, reviewed and saved as the permissions are.
  it('shows reports and bundles × roles with ticks, and gives and takes away through the review', async () => {
    answers = { ...GRID(), change_report_grants: { saved: 2 } }
    const { all, click } = await render('grid')
    await click(viewButton('Reports'))
    expect([all('grid-group').map(g => g.textContent), all('grid-row-title').map(t => t.textContent)]).toEqual([['Reports', 'Bundles'], ['Visit Sales', 'Store pack']])
    const tick = (row: string, role: string) => all(`grid-cell-${row}-${role}`)[0]!.querySelector('button')!
    expect([tick('dash.report|vs', 'r-sm').textContent, tick('dash.report|vs', 'r-tl').textContent, tick('dash.report|vs', 'r-tl').getAttribute('title')])
      .toEqual(['✓', '—', "Team Leaders aren't given Visit Sales"])
    await click(tick('dash.report|vs', 'r-sm'))
    await click(tick('dash.report_bundle|b1', 'r-tl'))
    // Room under the last row while the dark bar shows.
    expect(all('reports-grid')[0]!.className).toContain('pb-16')
    await click([...all('pending-bar')[0]!.querySelectorAll('button')].find(b => b.textContent === 'Review and save')!)
    expect(all('review-line').map(l => l.textContent)).toEqual(['Store Managers · Visit Sales: given → not given', 'Team Leaders · Store pack: not given → given'])
    await click(all('review-save')[0]!)
    expect(calls.find(c => c.name === 'change_report_grants')!.payload).toEqual({ changes: [
      { role: 'r-sm', table: 'dash.report', key: 'vs', from: true, to: false },
      { role: 'r-tl', table: 'dash.report_bundle', key: 'b1', from: false, to: true },
    ] })
  })

  it('offers the grid only while both sides are small', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, name: `Role ${i}`, permissions: [], reports: [], given: [], people: 0, people_from: 'nobody yet', holders: [], description: null, by_hand_only: false, reaches: 'x' }))
    answers = GRID(true, many)
    const { all } = await render('grid')
    expect(all('grid-too-big')[0]!.textContent).toContain('at most 40 roles and 40 permissions; here there are 42 roles and 2 permissions')
  })

  // #1340: Featherbase's Open as grid on a role's Reports opens the reports grid at once.
  it('opens on the reports grid when Featherbase asks for it', async () => {
    window.history.replaceState(null, '', '/dash/?view=roles-grid&grid=reports')
    try {
      answers = GRID()
      const { all } = await render('grid')
      expect([all('reports-grid').length, all('permissions-grid').length]).toEqual([1, 0])
    } finally { window.history.replaceState(null, '', '/dash/?view=explain&person=sm') }
  })
})

describe('Who Would Gain Or Lose Access', () => {
  const person = (over: Record<string, unknown>) => ({ person: 'st', name: 'Siva', who: { code: '3006', jobs: ['Staff · Lakeside'], staff: 'current', held: [{ job: 'Staff', site: { id: 'LKS', name: 'Lakeside' } }] },
    kinds: ['loses_dash'], roles: ['Staff'], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [],
    today: { opens: true, reports: 1, stores: 1 }, next: { opens: false, reports: 0, stores: 0 }, decided: false, ...over })
  const SIVA = person({})
  const HEMA = person({ person: 'ho', name: 'Hema', kinds: ['loses_dash', 'decision'], decisions: [{ name: 'Sales', table: 'dash.report', id: 'sales' }],
    who: { code: '3007', jobs: ['Head office staff · Head office'], staff: 'current', held: [{ job: 'Head office staff', site: { id: 'HOF', name: 'Head office' } }] } })
  const OMANA = person({ person: 'od', name: 'Omana', kinds: ['stores', 'gains_dash'], today: { opens: false, reports: 0, stores: 0 }, next: { opens: true, reports: 2, stores: 3 },
    stores_gained: [{ name: 'Hillview', table: 'Site', id: 'HIL' }] })
  const CHANGES = { access_changes: { people: 10, changed: 3, groups: [
    { kind: 'loses_dash', people: [SIVA, HEMA] }, { kind: 'gains_dash', people: [OMANA] }, { kind: 'stores', people: [OMANA] }, { kind: 'reports', people: [] },
    { kind: 'decision', people: [HEMA] }] }, access_source: { source: 'legacy' } }

  it('answers first: how many change, how many are decided, how many need a decision, and who gains', async () => {
    answers = CHANGES
    const { all, container } = await render('changes')
    expect(container.textContent).toContain('3 of 10 people would see something different. 2 of the 3 are changes already decided; 1 needs your decision before the switch.')
    expect(all('changes-detail')[0].textContent).toBe('1 person would gain Dash. The other 7 keep exactly what they have.')
    expect(all('decides-today')[0].textContent).toBe('Today old rules decide')
    expect(all('changes-checked')[0].textContent).toMatch(/^Old rules compared with business roles · checked \d{2}-[A-Z][a-z]{2}-\d{4}/)
  })

  it('gives four findings with their counts, each a filter for the list', async () => {
    answers = CHANGES
    const { all, click } = await render('changes')
    expect(all('finding-card').map(c => [c.querySelector('[data-testid="finding-count"]')!.textContent, c.querySelector('.font-semibold:not([data-testid])')?.textContent]))
      .toEqual([['1', 'Need A Decision'], ['2', 'Lose Dash'], ['1', 'See Different Stores'], ['1', 'See Different Reports']])
    expect(all('changed-name').map(n => n.textContent)).toEqual(['Hema', 'Omana', 'Siva'])
    await click(all('finding-card')[2]!)
    expect([all('finding-card')[2]!.getAttribute('aria-pressed'), all('changed-name').map(n => n.textContent)]).toEqual(['true', ['Omana']])
    await click(all('finding-card')[2]!)
    expect(all('changed-name').length).toBe(3)
  })

  it('lists everyone who changes: each person a link to Explain A Person, their HR title, site, today and with business roles', async () => {
    answers = CHANGES
    const { all } = await render('changes')
    const siva = all('changed-person').find(r => r.textContent!.includes('Siva'))!
    expect(siva.querySelector('a[href="?view=explain&person=st"]')).not.toBeNull()
    expect(siva.textContent).toContain('Siva 3006')
    expect(siva.textContent).toContain('Staff')
    expect(siva.textContent).toContain('Lakeside')
    expect(siva.textContent).toContain('Dash opens · 1 report · 1 store')
    expect(siva.textContent).toContain('No Dash')
  })

  it('searches the list by name, title or site', async () => {
    answers = CHANGES
    const { all, set } = await render('changes')
    await set(all('changes-search')[0] as HTMLInputElement, 'head office')
    expect(all('changed-name').map(n => n.textContent)).toEqual(['Hema'])
  })

  it('gives a card to each person who needs a decision, with Give A Role… and Let Them Lose Dash', async () => {
    answers = { ...CHANGES, decide_access: { person: 'ho', decision: 'Lose Dash' } }
    const { all, click } = await render('changes')
    expect(all('decide-card').map(c => c.textContent!.startsWith('Hema'))).toEqual([true])
    expect(all('give-a-role')[0]!.getAttribute('href')).toBe('?view=explain&person=ho&give=1')
    await click(all('let-lose')[0]!)
    // It asks first; Keep leaves it undecided.
    expect(all('lose-confirm')[0]!.textContent).toContain('Let Hema lose Dash with business roles?')
    await click(all('lose-keep')[0]!)
    expect(calls.some(c => c.name === 'decide_access')).toBe(false)
    await click(all('let-lose')[0]!)
    await click(all('lose-yes')[0]!)
    expect([calls.find(c => c.name === 'decide_access')?.payload, calls.filter(c => c.name === 'access_changes').length]).toEqual([{ person: 'ho' }, 2])
    expect(all('decided')[0]!.textContent).toBe('Hema will lose Dash with business roles. ')
    await click(all('undo-lose')[0]!)
    expect([calls.filter(c => c.name === 'decide_access').at(-1)?.payload, all('decided').length]).toEqual([{ person: 'ho', undo: true }, 0])
  })

  it('counts someone the owner decided as decided, with no card', async () => {
    answers = { ...CHANGES, access_changes: { ...CHANGES.access_changes, groups: CHANGES.access_changes.groups.map(g => ({ ...g, people: g.people.map(p => p.person === 'ho' ? { ...p, decided: true } : p) })) } }
    const { all, container } = await render('changes')
    expect([all('decide-card').length, container.textContent!.includes('3 of the 3 are changes already decided; 0 need your decision')]).toEqual([0, true])
  })

  it('checks again on request', async () => {
    answers = CHANGES
    const { all, click } = await render('changes')
    await click(all('check-again')[0]!)
    expect(calls.filter(c => c.name === 'access_changes').length).toBe(2)
  })

  it('exports the list as a CSV, one line per person', async () => {
    const { changesCsv } = await import('./access-changes-page')
    expect(changesCsv([HEMA as never, SIVA as never]).split('\n')).toEqual([
      'Person,HR Title,Site,Today,With Business Roles,Decision,Why',
      'Hema,Head office staff,Head office,Dash opens · 1 report · 1 store,No Dash · 0 reports · 0 stores,Needs a decision,Would lose Dash; Needs a decision: Sales',
      'Siva,Staff,Lakeside,Dash opens · 1 report · 1 store,No Dash · 0 reports · 0 stores,Decided,Would lose Dash', ''])
  })

  it('says everyone keeps what they have when nobody changes', async () => {
    answers = { access_changes: { people: 4, changed: 0, groups: [] } }
    const { container } = await render('changes')
    expect(container.textContent).toContain('All 4 people would keep exactly what they have.')
  })

  // #1277: a role viewing every report is said in plain words, not report by report.
  it('says every report, through Owner Director, instead of listing each report gained', async () => {
    const report = (name: string) => ({ name, table: 'dash.report', id: name })
    answers = { access_changes: { people: 1, changed: 1, groups: [{ kind: 'reports', people: [person({ person: 'od', name: 'Omana', kinds: ['reports'], roles: ['Owner Director'],
      gained: [report('Sales'), report('Stock')], every_report: ['Owner Director'] })] }] } }
    const { all } = await render('changes')
    expect(all('change-fact').map(f => f.textContent)).toEqual(['Would get every report, through Owner Director'])
  })

  // #1277 (decision 7): each old grant left where it is, with who would lose its reports.
  it('lists each grant not carried over, with the people who would lose its reports, each a link', async () => {
    const vs = { name: 'Vendor Sales', table: 'dash.report', id: 'vs' }
    answers = { access_changes: { people: 2, changed: 1, groups: [], not_carried_over: [
      { grant: 'a1', gives: vs, receiver: { kind: 'job', name: 'Store Manager' }, note: 'Not carried over: add on request', people: [{ person: 'sm', name: 'Selvi', reports: [vs] }] },
      { grant: 'a8', gives: { name: 'Store pack', table: 'dash.report_bundle', id: 'b1' }, receiver: { kind: 'role', name: 'Dash All-Stores Reader' }, note: 'Not carried over: add on request', people: [] }] } }
    const { all } = await render('changes')
    const section = all('not-carried-over')[0]!
    expect([section.querySelector('[data-testid="link-section-count"]')!.textContent, all('not-carried-grant').map(l => l.textContent),
      all('not-carried-person').map(a => [a.textContent, a.querySelector('a')!.getAttribute('href')])]).toEqual([
      '2',
      ['Vendor Sales · to the job Store Manager', 'Store pack · to the role Dash All-Stores Reader'],
      [['Selvi', '?view=explain&person=sm']]])
    expect(all('not-carried-people').map(p => p.textContent)).toEqual(['Not carried over: add on request. Would lose Vendor Sales: Selvi', 'Not carried over: add on request. Nobody would lose a report'])
  })
})

// #1340: Business Roles moved to Featherbase; its old addresses go there.
describe('the old Business Roles address', () => {
  it('goes to the business roles in Featherbase, or one role\'s own page there; any other address stays', async () => {
    const { movedRolesAddress } = await import('./roles-shared')
    expect([movedRolesAddress('?view=roles'), movedRolesAddress('?view=roles&role=r%201'), movedRolesAddress('?view=explain')])
      .toEqual(['/featherbase/admin/table/dash.business_role', '/featherbase/admin/table/dash.business_role/row/r%201', null])
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
